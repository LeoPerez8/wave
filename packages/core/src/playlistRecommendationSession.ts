import {
  PLAYLIST_SHOWN_OFFERS,
  playlistOfferFits,
  playlistRecommendations,
  type PlaylistRecommendationSources,
  type PlaylistRecommendationTrack,
  type PlaylistRecommendation,
} from "./playlistRecommendations.ts";
import {
  PLAYLIST_SAVED_OFFERS,
  PLAYLIST_SPARES_LOW,
  playlistOfferGone,
  playlistOffersToSave,
  playlistOffersToShow,
  playlistOffersWithSpares,
  playlistOffersWithout,
  playlistSpareCount,
  playlistSpareOffer,
} from "./playlistSavedOffers.ts";
import { roundMs } from "./timing.ts";

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

/**
 * What an Add or Dismiss made the owner wait for (ms): from the tap until the slot showed
 * its next offer or gave up. Only "offer" is an offer shown.
 */
export interface PlaylistSlotWait {
  readonly action: "add" | "dismiss";
  readonly ms: number;
  readonly outcome: "offer" | "no offer" | "refill failed" | "cancelled" | "save failed";
  /** Where the slot's offer came from; "placeholder", none came. */
  readonly from: "spare" | "ranking" | "placeholder";
}

/** [wait] as one log line, under `WaveTiming`. */
// not UI text: the app log's line
export const playlistSlotWaitLine = ({ action, ms, outcome, from }: PlaylistSlotWait): string =>
  `Playlist slot wait: ${action === "add" ? "Add" : "Dismiss"} ${outcome} after ${roundMs(ms)} (from ${from})`;

/** What one read and ranking did for the reserve; a refill cancelled by leaving reports nothing. */
export interface PlaylistReserveRefill {
  readonly ms: number;
  /** Offers it saved that weren't saved before. */
  readonly added: number;
  /** The spares ready afterwards. */
  readonly spares: number;
  readonly failed: boolean;
}

/** [refill] as one log line, under `WaveTiming`. */
// not UI text: the app log's line
export const playlistReserveRefillLine = ({
  ms,
  added,
  spares,
  failed,
}: PlaylistReserveRefill): string =>
  failed
    ? `Playlist reserve refill failed after ${roundMs(ms)}`
    : `Playlist reserve refill: ${added} new ${added === 1 ? "spare" : "spares"}, ${spares} ready after ${roundMs(ms)}`;

/** Whether a row would show [b] otherwise than [a]; what only ranking reads doesn't count. */
const showsOtherwise = (a: PlaylistRecommendationTrack, b: PlaylistRecommendationTrack): boolean =>
  a.videoId !== b.videoId ||
  a.title !== b.title ||
  a.album !== b.album ||
  a.albumId !== b.albumId ||
  a.durationMs !== b.durationMs ||
  a.artworkUrl !== b.artworkUrl ||
  a.explicit !== b.explicit ||
  a.artists.length !== b.artists.length ||
  a.artists.some((artist, index) => artist !== b.artists[index]);

/**
 * The newly read tracks of the offers in [slots]: as [ranked], or as the [library] holds an
 * offer a renewal no longer ranks. One pass, looking up five ids, however long the Library.
 */
const latestTracks = (
  slots: readonly (PlaylistRecommendationSlot | null)[],
  ranked: readonly PlaylistRecommendation[],
  library: readonly PlaylistRecommendationTrack[],
): ReadonlyMap<string, PlaylistRecommendationTrack> => {
  const showing = new Set(slots.flatMap((offer) => (offer === null ? [] : [offer.track.id])));
  const latest = new Map<string, PlaylistRecommendationTrack>();
  if (showing.size === 0) return latest;
  for (const song of library) if (showing.has(song.id)) latest.set(song.id, song);
  for (const { track } of ranked) if (showing.has(track.id)) latest.set(track.id, track);
  return latest;
};

/**
 * Owns visible offers and save-before-replace ordering; storage is a system boundary.
 * Only a renewal with nothing to show publishes its offers; over offers already showing
 * it runs behind them (docs/spec.md, "Saved offers").
 */
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
    /** Told once for each Add or Dismiss the session took, by the same clock. */
    readonly slotWait?: (wait: PlaylistSlotWait) => void;
    /** Told once for each read and ranking that refilled the reserve, or failed to. */
    readonly reserveRefill?: (refill: PlaylistReserveRefill) => void;
  };
  /** Which offers a read says can no longer stand; absent, it's worked out at once. */
  readonly gone?: (
    input: PlaylistRecommendationSessionInput,
    signal?: AbortSignal,
  ) => Promise<(offer: PlaylistRecommendationTrack) => boolean>;
  /**
   * The offers an earlier visit saved, shown from the start, and where changes to them go.
   * Without it nothing is kept: no spares, so every freed slot waits for its refill.
   */
  readonly saved?: {
    readonly offers: readonly PlaylistRecommendationTrack[];
    readonly online: () => boolean;
    readonly write: (offers: readonly PlaylistRecommendationTrack[]) => void;
  };
}) => {
  const slot = (track: PlaylistRecommendationTrack): PlaylistRecommendationSlot => ({
    key: options.newId(),
    track,
  });
  let savedOffers = options.saved?.offers ?? [];
  const online = () => options.saved?.online() ?? true;
  const spareCount = () => playlistSpareCount(savedOffers, held(), { online: online() });
  /**
   * The spares below which a tap refills the reserve. A ranking that left it short has already
   * found what it could, so another waits for the last spare, not the next tap, until spares
   * are plentiful again.
   */
  let refillBelow = PLAYLIST_SPARES_LOW;
  const saveOffers = (next: readonly PlaylistRecommendationTrack[]) => {
    if (options.saved === undefined || next === savedOffers) return;
    savedOffers = next;
    options.saved?.write(next);
    if (spareCount() >= PLAYLIST_SPARES_LOW) refillBelow = PLAYLIST_SPARES_LOW;
  };
  const firstShown = playlistOffersToShow(savedOffers, { online: online() }).map(slot);
  let state: PlaylistRecommendationState = {
    slots: firstShown,
    loading: firstShown.length === 0,
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
  // The reserve is low: the next batch reads and ranks even with no slot waiting.
  let reserveWanted = false;
  // Who waits for each freed slot's refill to end.
  const holeWaiters = new Map<number, (() => void)[]>();
  let disposed = false;
  let paused = false;
  /** Something was published while paused: listeners hear it on resuming. */
  let unheard = false;
  let version = 0;
  let active: AbortController | undefined;
  let renewalPending = false;
  /** A renewal running behind the offers on screen: anything touching a slot goes first. */
  let behind: AbortController | undefined;
  /** Stops the renewal behind the offers, to run again after what's about to change them. */
  const holdRenewal = () => {
    if (behind === undefined) return;
    behind.abort();
    behind = undefined;
    renewalPending = true;
  };
  /** The Adds and Dismisses whose slot hasn't ended its wait, by slot, with when they were tapped. */
  const slotWaits = new Map<number, { action: PlaylistSlotWait["action"]; at: number }>();
  const slotWaitEnded = (hole: number, outcome: Exclude<PlaylistSlotWait["outcome"], "offer">) => {
    const wait = slotWaits.get(hole);
    if (wait === undefined) return;
    slotWaits.delete(hole);
    const { timed } = options;
    timed?.slotWait?.({
      action: wait.action,
      ms: timed.now() - wait.at,
      outcome,
      from: "placeholder",
    });
  };
  /** The offer just published counts once its frame has had its turn, without holding up the refill. */
  const slotWaitFilled = (hole: number, from: PlaylistSlotWait["from"]) => {
    const wait = slotWaits.get(hole);
    if (wait === undefined) return;
    slotWaits.delete(hole);
    const report = () => {
      const { timed } = options;
      timed?.slotWait?.({ action: wait.action, ms: timed.now() - wait.at, outcome: "offer", from });
    };
    if (yieldTurn === undefined) report();
    else void yieldTurn("paint").then(report, report);
  };
  const busy = () => renewing || refilling || savesRunning > 0;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const publish = (patch: Partial<PlaylistRecommendationState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    if (paused) unheard = true;
    else notify();
  };
  const read = async (signal?: AbortSignal) => {
    const input = await options.read(signal);
    return { ...input, sources: { ...input.sources, exclude: consumed } };
  };
  const rank = (input: PlaylistRecommendationSessionInput, signal?: AbortSignal) =>
    options.rank?.(input, signal) ??
    Promise.resolve(playlistRecommendations(input.playlist, input.sources, PLAYLIST_SAVED_OFFERS));
  const held = () => state.slots.flatMap((offer) => (offer === null ? [] : [offer.track]));
  const pendingSlotsBut = (holes: readonly number[]) =>
    state.pendingSlots.filter((pending) => !holes.includes(pending));
  const releaseHoles = (holes: readonly number[]) => {
    for (const hole of holes) {
      for (const resolve of holeWaiters.get(hole) ?? []) resolve();
      holeWaiters.delete(hole);
    }
  };
  /**
   * Fills what it can of [holes], empty slots of [slots], from the saved spares, with no read
   * or ranking, and returns the rest. A spare fits the offers kept and those it just placed.
   */
  const fillFromSpares = (
    slots: (PlaylistRecommendationSlot | null)[],
    holes: readonly number[],
  ): readonly number[] => {
    const kept = slots.flatMap((offer) => (offer === null ? [] : [offer.track]));
    return holes.filter((hole) => {
      const spare = playlistSpareOffer(savedOffers, kept, { online: online() });
      if (spare === undefined) return true;
      kept.push(spare);
      slots[hole] = slot(spare);
      return false;
    });
  };
  /** Slots waiting on a placeholder take the spares that have come since they began waiting. */
  const fillWaitingFromSpares = () => {
    if (waiting.length === 0 || savedOffers.length === 0) return;
    const holes = waiting.splice(0);
    const slots = [...state.slots];
    const rest = fillFromSpares(slots, holes);
    waiting.push(...rest);
    const filled = holes.filter((hole) => !rest.includes(hole));
    if (filled.length === 0) return;
    publish({ slots, pendingSlots: pendingSlotsBut(filled) });
    for (const hole of filled) slotWaitFilled(hole, "spare");
    releaseHoles(filled);
  };
  /** The freed slots' choices are saved: the slots leave no placeholder, waiting for a retry. */
  const leaveUnfilled = (holes: readonly number[]) =>
    publish({ pendingSlots: pendingSlotsBut(holes), unfilled: [...state.unfilled, ...holes] });
  /**
   * Fills the waiting slots and the reserve, a batch at a time: what a batch ranks past its
   * slots joins the spares, and slots freed while it's read and ranked take those, else wait
   * for the next batch. With no slot waiting, nothing showing changes and a failure only
   * logs. No batch asks for another: only a tap or an offer leaving finds the reserve low.
   * [turn] is the first batch's first step.
   */
  const refill = async (turn: PlaylistRecommendationTurn) => {
    if (refilling) return;
    refilling = true;
    while (waiting.length > 0 || reserveWanted) {
      // Hidden or gone mid-way (an earlier batch's turns): stop before reading again.
      if (disposed || paused) break;
      fillWaitingFromSpares();
      if (waiting.length === 0 && !reserveWanted) break;
      reserveWanted = false;
      // A slot whose replacement failed meanwhile is retried with this batch, after its own.
      const retried = waiting.length > 0 ? state.unfilled : [];
      if (retried.length > 0)
        publish({ pendingSlots: [...state.pendingSlots, ...retried], unfilled: [] });
      const holes = [...waiting.splice(0), ...retried];
      const controller = new AbortController();
      active = controller;
      const startedAt = options.timed?.now() ?? 0;
      const reported = (added: number, failed: boolean) => {
        const { timed } = options;
        if (timed === undefined || options.saved === undefined) return;
        timed.reserveRefill?.({ ms: timed.now() - startedAt, added, spares: spareCount(), failed });
      };
      try {
        // The write's own list refresh and any scroll go first; then read and rank on separate turns.
        if (yieldTurn !== undefined) await yieldTurn(turn);
        turn = "free";
        controller.signal.throwIfAborted();
        const input = await read(controller.signal);
        if (yieldTurn !== undefined) await yieldTurn("paint");
        // Offers still showing, their saves under way among them, and the spares stay out of the
        // ranking: all it brings is new, and nothing tapped from now on can be among it.
        const ranked = await rank(
          {
            ...input,
            sources: { ...input.sources, exclude: [...consumed, ...held(), ...savedOffers] },
          },
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
        if (holes.length > 0) publish({ slots, pendingSlots: pendingSlotsBut(holes) });
        const before = savedOffers;
        // What filled a slot goes first: the next visit shows it, if there's room for only some.
        const others = ranked.flatMap(({ track }) => (taken.includes(track) ? [] : [track]));
        saveOffers(playlistOffersWithSpares(savedOffers, [...taken, ...others]));
        // No more than this to be found for now: the next read waits for the last spare.
        if (spareCount() < PLAYLIST_SPARES_LOW) refillBelow = 1;
        reported(savedOffers.length - before.length, false);
        for (const hole of holes) {
          if (slots[hole] === null) slotWaitEnded(hole, "no offer");
          else slotWaitFilled(hole, "ranking");
        }
      } catch {
        if (holes.length > 0) {
          // Paused or disposed mid-refill: the choices are saved, so their holes wait unfilled, without an error.
          leaveUnfilled(holes);
          // A failed save's message stays: its offer still waits for another try.
          if (!controller.signal.aborted && state.error !== "save") publish({ error: "refill" });
        }
        if (!controller.signal.aborted) reported(0, true);
        for (const hole of holes)
          slotWaitEnded(hole, controller.signal.aborted ? "cancelled" : "refill failed");
      } finally {
        if (active === controller) active = undefined;
        releaseHoles(holes);
      }
    }
    // Hidden or gone: what's left waits for the next refill or renewal.
    const left = waiting.splice(0);
    if (left.length > 0) leaveUnfilled(left);
    for (const hole of left) slotWaitEnded(hole, "cancelled");
    releaseHoles(left);
    reserveWanted = false;
    refilling = false;
  };
  /**
   * After a slot took a spare: below the mark, the reserve refills behind the screen, and no
   * one waits for it. A renewal under way or owed saves new offers anyway, so it goes instead.
   */
  const reserveLowPoint = () => {
    if (options.saved === undefined || disposed || paused) return;
    if (refilling || renewing || renewalPending || behind !== undefined) return;
    if (spareCount() >= refillBelow) return;
    reserveWanted = true;
    void refill("free").then(settle);
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
    if (renewalPending && !busy()) await session.renew({ turn: "free" });
  };
  const act = async (
    action: PlaylistSlotWait["action"],
    key: string,
    save: ((offer: PlaylistRecommendationSlot) => Promise<unknown>) | undefined,
  ): Promise<boolean> => {
    const index = state.slots.findIndex((x) => x?.key === key);
    const offer = state.slots[index];
    if (disposed || paused || renewing || offer == null || save === undefined) return false;
    if (state.pending.includes(key)) return false;
    if (options.timed?.slotWait !== undefined)
      slotWaits.set(index, { action, at: options.timed.now() });
    holdRenewal();
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
      slotWaitEnded(index, "save failed");
      await settle();
      return false;
    }
    savesRunning--;
    consumed.push(offer.track);
    if (savedOffers.length > 0) saveOffers(playlistOffersWithout(savedOffers, [offer.track]));
    const slots = [...state.slots];
    slots[index] = null;
    const holes = [index, ...earlier];
    // Closed meanwhile, nothing would show it: the refill says the wait was cancelled.
    const unspared = disposed ? holes : fillFromSpares(slots, holes);
    const spared = holes.filter((hole) => !unspared.includes(hole));
    publish({
      pending: state.pending.filter((pending) => pending !== key),
      slots,
      pendingSlots: pendingSlotsBut(spared),
    });
    for (const hole of spared) slotWaitFilled(hole, "spare");
    if (unspared.length > 0) await replace(unspared, "free");
    else {
      // Its slot is filled: a renewal held for this tap runs behind it, with no one waiting.
      void settle();
      reserveLowPoint();
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
      if (disposed) return;
      paused = false;
      if (!unheard) return;
      unheard = false;
      notify();
    },
    /** Whether a renewal is running behind the offers, or was held off and hasn't run. */
    renewalOwed: () => renewalPending || behind !== undefined,
    /** The offers showing and those saved: all `leave` could take out. */
    offers: (): readonly PlaylistRecommendationTrack[] => [...held(), ...savedOffers],
    /**
     * [gone] offers left outside the suggestions (the playlist now holds them): each
     * showing one's slot takes a saved spare at once, else a refill. The others stay.
     * With [read] false nothing may read yet (the screen hasn't settled): a slot with no
     * spare keeps its placeholder for the next renewal, or an action's refill.
     */
    leave: (
      gone: (offer: PlaylistRecommendationTrack) => boolean,
      { read = true }: { readonly read?: boolean } = {},
    ): void => {
      if (disposed) return;
      if (savedOffers.some(gone)) saveOffers(savedOffers.filter((offer) => !gone(offer)));
      const slots = [...state.slots];
      const holes: number[] = [];
      for (const [index, offer] of slots.entries()) {
        if (offer === null || state.pending.includes(offer.key) || !gone(offer.track)) continue;
        slots[index] = null;
        holes.push(index);
      }
      if (holes.length === 0) return;
      const unspared = fillFromSpares(slots, holes);
      publish({ slots, pendingSlots: [...state.pendingSlots, ...unspared] });
      if (unspared.length === 0) {
        if (read) reserveLowPoint();
        return;
      }
      if (!read) {
        waiting.push(...unspared);
        return;
      }
      holdRenewal();
      void replace(unspared, "free");
    },
    subscribe: (listener: () => void) => {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * A full renewal re-ranks the offers, after the saves and refills under way
     * (external invalidations are retained until then), and saves them for the next
     * visit. With offers showing it runs behind them: they stay, Add and Dismiss go
     * first, a failure is only reported, and it fills only empty slots and those whose
     * offer its read says is gone, refreshing the tags of the others in place. With none,
     * it shows its loading, offers or failure.
     * Slots that waited for it (`leave`) go with a failure, leaving the list.
     * [refillOnly] retries the slots whose replacement failed, alongside any running
     * actions. [turn], the host's turn a full renewal reads on, once it shows it's
     * loading; a renewal whose asker has already waited for its turn (the playlist
     * visit) has none.
     */
    renew: async (
      request: {
        readonly refillOnly?: boolean;
        readonly signal?: AbortSignal | undefined;
        readonly turn?: PlaylistRecommendationTurn;
      } = {},
    ): Promise<void> => {
      if (disposed || paused || request.signal?.aborted) return;
      if (request.refillOnly === true) {
        if (renewing || state.unfilled.length === 0) return;
        holdRenewal();
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
      const showing = state.slots.some((offer) => offer !== null);
      behind?.abort();
      const controller = new AbortController();
      active = controller;
      behind = showing ? controller : undefined;
      const cancel = () => controller.abort();
      request.signal?.addEventListener("abort", cancel, { once: true });
      const current = () => !disposed && !controller.signal.aborted && revision === version;
      const unfilledBefore = state.unfilled;
      if (!showing) {
        renewing = true;
        publish({ loading: true, unfilled: [], error: null });
      }
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
        if (request.turn !== undefined && yieldTurn !== undefined) {
          await yieldTurn(request.turn);
          if (!current()) return;
        }
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
        const gone =
          showing || savedOffers.length > 0
            ? await (options.gone?.(input, controller.signal) ??
                Promise.resolve(playlistOfferGone(input.playlist, input.sources)))
            : () => false;
        if (!current()) return;
        const stillSaved = savedOffers.some(gone)
          ? savedOffers.filter((offer) => !gone(offer))
          : savedOffers;
        saveOffers(
          playlistOffersToSave(
            stillSaved,
            ranked.map((offer) => offer.track),
            { online: input.sources.online ?? true },
          ),
        );
        const waited = waiting.splice(0);
        const slots = Array.from(
          { length: PLAYLIST_SHOWN_OFFERS },
          (_, index): PlaylistRecommendationSlot | null => state.slots[index] ?? null,
        );
        // With nothing showing, the section's loading ends whatever this finds.
        let changed = !showing || state.unfilled.length > 0 || waited.length > 0;
        const reread = latestTracks(slots, ranked, input.sources.library);
        for (const [index, offer] of slots.entries()) {
          if (offer === null) continue;
          if (gone(offer.track)) {
            slots[index] = null;
            changed = true;
            continue;
          }
          // Fix Song or a scan changed its tags: the same offer, in its place, with what's true now.
          const latest = reread.get(offer.track.id);
          if (latest === undefined || !showsOtherwise(offer.track, latest)) continue;
          slots[index] = { ...offer, track: latest };
          changed = true;
        }
        // Empty slots take its offers, whatever emptied them or never filled them; an offer showing stays.
        const taken = slots.flatMap((offer) => (offer === null ? [] : [offer.track]));
        for (const [index, offer] of slots.entries()) {
          if (offer !== null) continue;
          const fits = playlistOfferFits(taken);
          const next = ranked.find((candidate) => fits(candidate.track));
          if (next === undefined) break;
          taken.push(next.track);
          slots[index] = slot(next.track);
          changed = true;
        }
        if (changed)
          publish({
            slots,
            pendingSlots: pendingSlotsBut(waited),
            unfilled: [],
            error: state.error === "refill" ? null : state.error,
          });
        timed(false);
      } catch {
        if (current()) {
          const waited = waiting.splice(0);
          if (waited.length > 0) publish({ pendingSlots: pendingSlotsBut(waited) });
          if (!showing) publish({ error: "load" });
          timed(true);
        }
      } finally {
        if (behind === controller) behind = undefined;
        if (!showing) {
          renewing = false;
          // Cancelled, a renewal is still owed, so the section keeps reading as loading until it
          // runs, and the holes it was to fill stay unfilled for the next refill.
          if (current()) publish({ loading: false });
          else
            state = {
              ...state,
              unfilled: unfilledBefore.filter((hole) => state.slots[hole] === null),
            };
        }
        request.signal?.removeEventListener("abort", cancel);
        if (active === controller) active = undefined;
        if (renewalPending && !disposed && !request.signal?.aborted)
          await session.renew({ signal: request.signal, turn: "free" });
      }
    },
    dismiss: (key: string) => act("dismiss", key, options.dismiss),
    accept: (key: string) => act("add", key, options.accept),
  };
  return session;
};
