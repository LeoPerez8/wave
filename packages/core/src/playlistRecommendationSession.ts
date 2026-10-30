import {
  playlistOfferFits,
  playlistRecommendations,
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
  /** The keys of the offers whose Add or Dismiss is running, in tap order. */
  readonly pending: readonly string[];
  /**
   * The slots an Add, a Dismiss or a refill retry is working on, from the tap
   * until their replacement (or its failure) lands: each holds a same-size
   * placeholder in place of its offer, so the other slots never move.
   */
  readonly pendingSlots: readonly number[];
  /**
   * Freed slots whose replacement couldn't be read, their choice saved: a
   * refill retry, or the next Add or Dismiss's refill, fills them without
   * saving again.
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

/** How long one full renewal took (ms), as the owner waited for it. */
export interface PlaylistRecommendationTiming {
  /** From the renewal's start until its offers (or its failure) showed. */
  readonly ms: number;
  readonly readMs: number;
  readonly rankMs: number;
  /** The offers showing afterwards. */
  readonly offers: number;
  readonly failed: boolean;
}

// not UI text: times for the app log
const roundMs = (ms: number) => `${Math.round(ms)} ms`;

/**
 * [timing] as one log line; [sinceOpenMs], the time since the playlist
 * opened, for the renewal that opening asked for.
 */
// not UI text: the app log's line
export const playlistSuggestionsLine = (
  { ms, readMs, rankMs, offers, failed }: PlaylistRecommendationTiming,
  sinceOpenMs?: number,
): string => {
  const parts = `(read ${roundMs(readMs)}, rank ${roundMs(rankMs)})`;
  const shown = `${offers} ${offers === 1 ? "offer" : "offers"}`;
  if (sinceOpenMs !== undefined) {
    const when = `${roundMs(sinceOpenMs)} after opening`;
    return failed
      ? `Playlist suggestions failed ${when} ${parts}`
      : `Playlist suggestions: ${shown} ${when} ${parts}`;
  }
  return failed
    ? `Playlist suggestions failed renewing after ${roundMs(ms)} ${parts}`
    : `Playlist suggestions renewed: ${shown} in ${roundMs(ms)} ${parts}`;
};

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
  /** Told how long each full renewal that showed its offers or failed took, by [now]'s clock. */
  readonly timed?: {
    readonly now: () => number;
    readonly report: (timing: PlaylistRecommendationTiming) => void;
  };
}) => {
  let state: PlaylistRecommendationState = {
    slots: [],
    loading: true,
    pending: [],
    pendingSlots: [],
    unfilled: [],
    error: null,
  };
  // Without a host turn, steps follow synchronously (no extra microtask before a save starts).
  const { yieldTurn } = options;
  const listeners = new Set<() => void>();
  const consumed: PlaylistRecommendationTrack[] = [];
  /** A full renewal is reading or ranking: Add and Dismiss wait for its offers. */
  let renewing = false;
  // Saves run one at a time, in tap order, so no choice is written twice or out of turn.
  let saveQueue: Promise<unknown> = Promise.resolve();
  let savesRunning = 0;
  // Freed slots, their choice saved, that the next refill fills.
  const waiting: number[] = [];
  let refilling = false;
  // Who waits for each freed slot's refill to end.
  const holeWaiters = new Map<number, (() => void)[]>();
  let disposed = false;
  let paused = false;
  let version = 0;
  let active: AbortController | undefined;
  let renewalPending = false;
  const busy = () => renewing || refilling || savesRunning > 0;
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
  const held = () => state.slots.flatMap((offer) => (offer === null ? [] : [offer.track]));
  const pendingSlotsBut = (holes: readonly number[]) =>
    state.pendingSlots.filter((pending) => !holes.includes(pending));
  const releaseHoles = (holes: readonly number[]) => {
    for (const hole of holes) {
      for (const resolve of holeWaiters.get(hole) ?? []) resolve();
      holeWaiters.delete(hole);
    }
  };
  /** The freed slots' choices are saved: the slots leave no placeholder, waiting for a retry. */
  const leaveUnfilled = (holes: readonly number[]) =>
    publish({ pendingSlots: pendingSlotsBut(holes), unfilled: [...state.unfilled, ...holes] });
  /**
   * Fills the waiting slots, a batch at a time: slots freed while one batch is
   * read and ranked wait for the next. [turn] is the first batch's first step.
   */
  const refill = async (turn: PlaylistRecommendationTurn) => {
    if (refilling) return;
    refilling = true;
    while (waiting.length > 0) {
      // Hidden or gone mid-way (an earlier batch's turns): stop before reading again.
      if (disposed || paused) break;
      // A slot whose replacement failed meanwhile is retried with this batch, after its own.
      const retried = state.unfilled;
      if (retried.length > 0)
        publish({ pendingSlots: [...state.pendingSlots, ...retried], unfilled: [] });
      const holes = [...waiting.splice(0), ...retried];
      const controller = new AbortController();
      active = controller;
      try {
        // The write's own list refresh and any scroll go first; then read and rank on separate turns.
        if (yieldTurn !== undefined) await yieldTurn(turn);
        turn = "free";
        controller.signal.throwIfAborted();
        const input = await read(controller.signal);
        if (yieldTurn !== undefined) await yieldTurn("paint");
        // Offers still showing, their saves under way among them, stay out of the ranking.
        const ranked = await rank(
          { ...input, sources: { ...input.sources, exclude: [...consumed, ...held()] } },
          controller.signal,
        );
        controller.signal.throwIfAborted();
        const slots = [...state.slots];
        const kept = held();
        const taken: PlaylistRecommendationTrack[] = [];
        for (const hole of holes) {
          if (slots[hole] !== null) continue;
          // The held offers count towards the artist cap, as do the replacements taken so far.
          const fits = playlistOfferFits([...kept, ...taken]);
          const next = ranked.find((candidate) => fits(candidate.track));
          if (next === undefined) break;
          taken.push(next.track);
          slots[hole] = slot(next.track);
        }
        publish({ slots, pendingSlots: pendingSlotsBut(holes) });
      } catch {
        // Paused or disposed mid-refill: the choices are saved, so their holes wait unfilled, without an error.
        leaveUnfilled(holes);
        // A failed save's message stays: its offer still waits for another try.
        if (!controller.signal.aborted && state.error !== "save") publish({ error: "refill" });
      } finally {
        if (active === controller) active = undefined;
        releaseHoles(holes);
      }
    }
    // Hidden or gone: what's left waits for the next refill or renewal.
    const left = waiting.splice(0);
    if (left.length > 0) leaveUnfilled(left);
    releaseHoles(left);
    refilling = false;
  };
  /** Refills [holes] (their choices saved), then runs a renewal asked for meanwhile. */
  const replace = async (holes: readonly number[], turn: PlaylistRecommendationTurn) => {
    waiting.push(...holes);
    const replaced = Promise.all(
      holes.map(
        (hole) =>
          new Promise<void>((resolve) => {
            holeWaiters.set(hole, [...(holeWaiters.get(hole) ?? []), resolve]);
          }),
      ),
    );
    void refill(turn);
    await replaced;
    await settle();
  };
  /** A renewal asked for while offers were being saved or replaced runs once they're done. */
  const settle = async () => {
    if (renewalPending && !busy()) await session.renew();
  };
  const act = async (
    key: string,
    save: ((offer: PlaylistRecommendationSlot) => Promise<unknown>) | undefined,
  ): Promise<boolean> => {
    const index = state.slots.findIndex((x) => x?.key === key);
    const offer = state.slots[index];
    if (disposed || paused || renewing || offer == null || save === undefined) return false;
    if (state.pending.includes(key)) return false;
    // Slots whose replacement failed earlier are filled by this action's refill too.
    const earlier = state.unfilled;
    // Published before any work, so the tap's placeholder can paint on the next frame.
    publish({
      pending: [...state.pending, key],
      pendingSlots: [...state.pendingSlots, index, ...earlier],
      unfilled: [],
      error: null,
    });
    const write = async () => {
      if (yieldTurn !== undefined) await yieldTurn("paint");
      await save(offer);
    };
    // With no other save under way, this one starts at once.
    const saved = savesRunning > 0 ? saveQueue.then(write) : write();
    saveQueue = saved.catch(() => {});
    savesRunning++;
    try {
      await saved;
    } catch {
      savesRunning--;
      publish({
        pending: state.pending.filter((pending) => pending !== key),
        pendingSlots: pendingSlotsBut([index, ...earlier]),
        unfilled: [...state.unfilled, ...earlier],
        error: "save",
      });
      await settle();
      return false;
    }
    savesRunning--;
    consumed.push(offer.track);
    const slots = [...state.slots];
    slots[index] = null;
    publish({ pending: state.pending.filter((pending) => pending !== key), slots });
    await replace([index, ...earlier], "free");
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
    /**
     * A full renewal re-ranks every offer, after the saves and refills under way
     * (external invalidations are retained until then). [refillOnly] retries the
     * slots whose replacement failed, alongside any running actions.
     */
    renew: async (
      request: { readonly refillOnly?: boolean; readonly signal?: AbortSignal | undefined } = {},
    ): Promise<void> => {
      if (disposed || paused || request.signal?.aborted) return;
      if (request.refillOnly === true) {
        if (renewing || state.unfilled.length === 0) return;
        // A refill retry holds its slots' placeholders; only a full renewal reads as loading.
        const retrying = state.unfilled;
        publish({
          pendingSlots: [...state.pendingSlots, ...retrying],
          unfilled: [],
          error: null,
        });
        await replace(retrying, "paint");
        return;
      }
      const revision = ++version;
      if (busy()) {
        renewalPending = true;
        return;
      }
      renewalPending = false;
      const controller = new AbortController();
      active = controller;
      const cancel = () => controller.abort();
      request.signal?.addEventListener("abort", cancel, { once: true });
      const current = () => !disposed && !controller.signal.aborted && revision === version;
      renewing = true;
      const unfilledBefore = state.unfilled;
      publish({ loading: true, unfilled: [], error: null });
      const clock = options.timed?.now;
      const startedAt = clock?.() ?? 0;
      let readMs = 0;
      let rankMs = 0;
      const timed = (failed: boolean) => {
        if (clock === undefined) return;
        options.timed!.report({
          ms: clock() - startedAt,
          readMs,
          rankMs,
          offers: state.slots.filter((offer) => offer !== null).length,
          failed,
        });
      };
      try {
        let phase = clock?.() ?? 0;
        let input: PlaylistRecommendationSessionInput;
        try {
          input = await read(controller.signal);
        } finally {
          if (clock !== undefined) readMs = clock() - phase;
        }
        if (!current()) return;
        if (yieldTurn !== undefined) await yieldTurn("paint");
        if (!current()) return;
        phase = clock?.() ?? 0;
        let ranked: readonly PlaylistRecommendation[];
        try {
          ranked = await rank(input, controller.signal);
        } finally {
          if (clock !== undefined) rankMs = clock() - phase;
        }
        if (!current()) return;
        const eligible = new Map(ranked.map((x) => [x.track.id, x.track]));
        const slots = Array.from({ length: 5 }, (_, index) => {
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
          const shown = slots.flatMap((x) => (x === null ? [] : [x.track]));
          const fits = playlistOfferFits(shown);
          const next = ranked.find((candidate) => fits(candidate.track));
          if (next !== undefined) slots[index] = slot(next.track);
        }
        publish({ slots });
        timed(false);
      } catch {
        if (current()) {
          publish({ error: "load" });
          timed(true);
        }
      } finally {
        renewing = false;
        // Cancellation retains offers, and the holes it was to fill stay unfilled for the next refill.
        if (current()) publish({ loading: false });
        else
          state = {
            ...state,
            loading: false,
            unfilled: unfilledBefore.filter((hole) => state.slots[hole] === null),
          };
        request.signal?.removeEventListener("abort", cancel);
        if (active === controller) active = undefined;
        if (renewalPending && !disposed && !request.signal?.aborted)
          await session.renew({ signal: request.signal });
      }
    },
    dismiss: (key: string) => act(key, options.dismiss),
    accept: (key: string) => act(key, options.accept),
  };
  return session;
};
