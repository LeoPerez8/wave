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
  readonly pending: string | null;
  readonly error: "load" | "save" | "refill" | null;
}
export interface PlaylistRecommendationSessionInput {
  readonly playlist: readonly PlaylistRecommendationTrack[];
  readonly sources: PlaylistRecommendationSources;
}

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
}) => {
  let state: PlaylistRecommendationState = { slots: [], loading: true, pending: null, error: null };
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
    publish({ pending: key, error: null });
    try {
      await save(offer);
    } catch {
      working = false;
      active = undefined;
      publish({ pending: null, error: "save" });
      if (renewalPending) await session.renew();
      return false;
    }
    consumed.push(offer.track);
    const slots = [...state.slots];
    slots[index] = null;
    publish({ slots });
    try {
      controller.signal.throwIfAborted();
      const input = await read(controller.signal);
      const held = slots.flatMap((x) => (x === null ? [] : [x.track]));
      const next = (
        await rank(
          { ...input, sources: { ...input.sources, exclude: [...consumed, ...held] } },
          controller.signal,
        )
      )[0];
      controller.signal.throwIfAborted();
      if (next !== undefined) slots[index] = slot(next.track);
      publish({ slots: [...slots] });
    } catch {
      if (!controller.signal.aborted) publish({ error: "refill" });
    } finally {
      working = false;
      active = undefined;
      publish({ pending: null });
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
      publish({ loading: true, error: null });
      try {
        const input = await read(controller.signal);
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
        if (current()) publish({ error: request.refillOnly ? "refill" : "load" });
      } finally {
        working = false;
        // Cancellation retains offers, but must not leave their actions permanently busy.
        if (current()) publish({ loading: false });
        else state = { ...state, loading: false };
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
