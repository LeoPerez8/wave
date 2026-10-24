import {
  playlistRecommendations,
  playlistRecordingMatch,
  type PlaylistRecommendationSources,
  type PlaylistRecommendationTrack,
  type PlaylistRecommendation,
} from "./playlistRecommendations.ts";

export interface PlaylistRecommendationSlot {
  readonly key: string;
  readonly track: PlaylistRecommendationTrack;
}
export interface PlaylistRecommendationState {
  readonly slots: readonly (PlaylistRecommendationSlot | null)[];
  readonly loading: boolean;
  /** The key of the offer whose Add or Dismiss is running. */
  readonly pending: string | null;
  /**
   * The slots an Add, a Dismiss or a refill retry is working on, from the tap
   * until their replacement (or its failure) lands: each holds a same-size
   * placeholder in place of its offer, so the other slots never move.
   */
  readonly pendingSlots: readonly number[];
  /**
   * Freed slots whose replacement couldn't be read, their choice saved: a
   * refill-only renewal, or the next Add or Dismiss's refill, fills them
   * without saving again.
   */
  readonly unfilled: readonly number[];
  readonly error: "load" | "save" | "refill" | null;
}
export interface PlaylistRecommendationSessionInput {
  readonly playlist: readonly PlaylistRecommendationTrack[];
  readonly sources: PlaylistRecommendationSources;
}

/**
 * Where the session hands the thread back to its host between steps.
 * "paint": the state just published (a tap's placeholder) gets a frame
 * before synchronous storage or ranking work starts. "free": a replacement's
 * read gives rendering a frame when its shared work budget is used up.
 */
export type PlaylistRecommendationTurn = "paint" | "free";

/** Owns visible offers and save-before-replace ordering; storage is a system boundary. */
export const playlistRecommendationSession = (options: {
  readonly newId: () => string;
  readonly read: (signal?: AbortSignal) => Promise<PlaylistRecommendationSessionInput>;
  readonly rank?: (
    input: PlaylistRecommendationSessionInput,
    signal?: AbortSignal,
  ) => Promise<readonly PlaylistRecommendation[]>;
  readonly dismiss: (offer: PlaylistRecommendationSlot) => Promise<unknown>;
  readonly accept?: (offer: PlaylistRecommendationSlot) => Promise<unknown>;
  /** Resolves when the host's turn of [kind] comes; absent, steps follow on at once. */
  readonly yieldTurn?: (kind: PlaylistRecommendationTurn) => Promise<void>;
}) => {
  let state: PlaylistRecommendationState = {
    slots: [],
    loading: true,
    pending: null,
    pendingSlots: [],
    unfilled: [],
    error: null,
  };
  // Without a host turn, steps follow synchronously (no extra microtask before a save starts).
  const { yieldTurn } = options;
  const listeners = new Set<() => void>();
  const consumed: PlaylistRecommendationTrack[] = [];
  let working = false;
  let disposed = false;
  let paused = false;
  let version = 0;
  let active: AbortController | undefined;
  let renewalPending = false;
  const publish = (patch: Partial<PlaylistRecommendationState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    if (!paused) for (const listener of listeners) listener();
  };
  const read = async (signal?: AbortSignal) => {
    const input = await options.read(signal);
    return { ...input, sources: { ...input.sources, exclude: consumed } };
  };
  const rank = (input: PlaylistRecommendationSessionInput, signal?: AbortSignal) =>
    options.rank?.(input, signal) ??
    Promise.resolve(playlistRecommendations(input.playlist, input.sources));
  const slot = (track: PlaylistRecommendationTrack): PlaylistRecommendationSlot => ({
    key: options.newId(),
    track,
  });
  const act = async (
    key: string,
    save: ((offer: PlaylistRecommendationSlot) => Promise<unknown>) | undefined,
  ): Promise<boolean> => {
    const index = state.slots.findIndex((x) => x?.key === key);
    const offer = state.slots[index];
    if (disposed || paused || working || offer == null || save === undefined) return false;
    working = true;
    const controller = new AbortController();
    active = controller;
    // Slots whose replacement failed earlier are filled by this refill too, after this one.
    const earlier = state.unfilled.filter((hole) => hole !== index);
    const holes = [index, ...earlier];
    // Published before any work, so the tap's placeholder can paint on the next frame.
    publish({ pending: key, pendingSlots: holes, unfilled: [], error: null });
    try {
      if (yieldTurn !== undefined) await yieldTurn("paint");
      await save(offer);
    } catch {
      working = false;
      active = undefined;
      publish({ pending: null, pendingSlots: [], unfilled: earlier, error: "save" });
      if (renewalPending) await session.renew();
      return false;
    }
    consumed.push(offer.track);
    const slots = [...state.slots];
    slots[index] = null;
    publish({ slots });
    try {
      controller.signal.throwIfAborted();
      // The write's own list refresh and any scroll go first; then read and rank on separate turns.
      if (yieldTurn !== undefined) await yieldTurn("free");
      const input = await read(controller.signal);
      if (yieldTurn !== undefined) await yieldTurn("paint");
      const held = slots.flatMap((x) => (x === null ? [] : [x.track]));
      const ranked = await rank(
        { ...input, sources: { ...input.sources, exclude: [...consumed, ...held] } },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const taken = new Set<PlaylistRecommendationTrack>();
      for (const hole of holes) {
        if (slots[hole] !== null) continue;
        const occupied = playlistRecordingMatch([...taken]);
        const next = ranked.find((candidate) => occupied(candidate.track) === null);
        if (next === undefined) break;
        taken.add(next.track);
        slots[hole] = slot(next.track);
      }
      publish({ slots: [...slots] });
    } catch {
      // Paused or disposed mid-refill: the choice is saved, so its holes wait unfilled, without an error.
      if (controller.signal.aborted) publish({ unfilled: holes });
      else publish({ error: "refill", unfilled: holes });
    } finally {
      working = false;
      active = undefined;
      publish({ pending: null, pendingSlots: [] });
      if (renewalPending) await session.renew();
    }
    return true;
  };
  const session = {
    get: () => state,
    dispose: () => {
      disposed = true;
      active?.abort();
      listeners.clear();
    },
    pause: () => {
      paused = true;
      active?.abort();
    },
    resume: () => {
      if (!disposed) paused = false;
    },
    subscribe: (listener: () => void) => {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Retains external invalidations until the current save/read has finished. */
    renew: async (
      request: { readonly refillOnly?: boolean; readonly signal?: AbortSignal | undefined } = {},
    ): Promise<void> => {
      if (disposed || paused || request.signal?.aborted) return;
      const revision = ++version;
      if (working) {
        if (request.refillOnly !== true) renewalPending = true;
        return;
      }
      renewalPending = false;
      const controller = new AbortController();
      active = controller;
      const cancel = () => controller.abort();
      request.signal?.addEventListener("abort", cancel, { once: true });
      const current = () => !disposed && !controller.signal.aborted && revision === version;
      working = true;
      // A refill retry holds its slots' placeholders; only a full renewal reads as loading.
      const unfilledBefore = state.unfilled;
      const retrying = request.refillOnly === true ? unfilledBefore : [];
      if (request.refillOnly === true)
        publish({ pendingSlots: retrying, unfilled: [], error: null });
      else publish({ loading: true, unfilled: [], error: null });
      try {
        if (retrying.length > 0 && yieldTurn !== undefined) await yieldTurn("paint");
        const input = await read(controller.signal);
        if (!current()) return;
        if (yieldTurn !== undefined) await yieldTurn("paint");
        if (!current()) return;
        // Recovery excludes held offers before the limit and only fills holes, like the action.
        const preserved = request.refillOnly
          ? state.slots.flatMap((offer) => (offer === null ? [] : [offer.track]))
          : [];
        const ranked = await rank(
          { ...input, sources: { ...input.sources, exclude: [...consumed, ...preserved] } },
          controller.signal,
        );
        if (!current()) return;
        const eligible = new Map(ranked.map((x) => [x.track.id, x.track]));
        const slots = request.refillOnly
          ? [...state.slots]
          : Array.from({ length: 5 }, (_, index) => {
              const previous = state.slots[index];
              const track = previous == null ? undefined : eligible.get(previous.track.id);
              return track === undefined || previous == null
                ? null
                : track === previous.track
                  ? previous
                  : { ...previous, track };
            });
        for (let index = 0; index < slots.length; index++) {
          if (slots[index] !== null) continue;
          const held = slots.flatMap((x) => (x === null ? [] : [x.track]));
          const occupied = playlistRecordingMatch(held);
          const next = ranked.find((candidate) => occupied(candidate.track) === null);
          if (next !== undefined) slots[index] = slot(next.track);
        }
        publish({ slots });
      } catch {
        if (current())
          publish(
            request.refillOnly === true
              ? { error: "refill", unfilled: retrying }
              : { error: "load" },
          );
      } finally {
        working = false;
        // Cancellation retains offers, but must not leave their actions permanently busy,
        // and the holes it was to fill stay unfilled for the next refill.
        if (current())
          publish(request.refillOnly === true ? { pendingSlots: [] } : { loading: false });
        else
          state = {
            ...state,
            loading: false,
            pendingSlots: [],
            unfilled: unfilledBefore.filter((hole) => state.slots[hole] === null),
          };
        request.signal?.removeEventListener("abort", cancel);
        active = undefined;
        if (renewalPending && !disposed && !request.signal?.aborted)
          await session.renew({ signal: request.signal });
      }
    },
    dismiss: (key: string) => act(key, options.dismiss),
    accept: (key: string) => act(key, options.accept),
  };
  return session;
};
