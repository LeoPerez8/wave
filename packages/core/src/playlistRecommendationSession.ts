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
  playlistOfferGone,
  playlistOffersToSave,
  playlistOffersToShow,
  playlistOffersWithout,
  playlistOffersWithSpares,
  playlistSpareOffer,
} from "./playlistSavedOffers.ts";
import type { RadioRankingPage } from "./radioRanking.ts";
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
 * A fresh suggestion's read: all but the radios, and the radios still answering.
 * A radio answers null, or fails, when it has no page to give.
 */
export interface PlaylistRecommendationFreshRead {
  readonly input: PlaylistRecommendationSessionInput;
  readonly radios: readonly Promise<RadioRankingPage | null>[];
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

/**
 * Takes the pages of [radios] as they answer: each call gives those that answered since the
 * last one, waiting for one if there are none, and nothing once every radio has settled.
 */
const radioAnswers = (
  radios: readonly Promise<RadioRankingPage | null>[],
  signal: AbortSignal,
): (() => Promise<readonly RadioRankingPage[]>) => {
  let unsettled = radios.length;
  let answered: RadioRankingPage[] = [];
  let wake = () => {};
  const settled = (page: RadioRankingPage | null) => {
    unsettled--;
    if (page !== null) answered.push(page);
    wake();
  };
  for (const radio of radios)
    radio.then(settled, () => {
      settled(null);
    });
  signal.addEventListener("abort", () => wake(), { once: true });
  return async () => {
    while (answered.length === 0 && unsettled > 0) {
      signal.throwIfAborted();
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    signal.throwIfAborted();
    const pages = answered;
    answered = [];
    return pages;
  };
};

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
  /**
   * With nothing showing, a renewal's read in place of [read], so offers can show from the
   * first radio to answer; absent, it reads and ranks all the radios together.
   */
  readonly readFresh?: (signal?: AbortSignal) => Promise<PlaylistRecommendationFreshRead>;
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
  const saveOffers = (next: readonly PlaylistRecommendationTrack[]) => {
    if (options.saved === undefined || next === savedOffers) return;
    savedOffers = next;
    options.saved?.write(next);
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
  /** A fresh renewal's offers show and its other radios feed the spares: taps don't stop those. */
  let later: AbortController | undefined;
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
  /** [input] to rank just [pages], without the offers already taken or showing. */
  const radiosInput = (
    input: PlaylistRecommendationSessionInput,
    pages: readonly RadioRankingPage[],
  ): PlaylistRecommendationSessionInput => ({
    ...input,
    sources: { ...input.sources, pages, exclude: [...consumed, ...held()] },
  });
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
  /**
   * Ranks each later radio's answer ([next], those answering during a ranking together) and
   * adds its offers to the spares. Offers showing stay; only a slot with no offer, and no refill
   * working on it, takes one. A failure costs only the spares: the offers already show.
   */
  const addSpares = async (
    next: () => Promise<readonly RadioRankingPage[]>,
    input: PlaylistRecommendationSessionInput,
    current: () => boolean,
    controller: AbortController,
  ) => {
    const openSlots = () =>
      state.slots.flatMap((offer, index) =>
        offer === null && !state.pendingSlots.includes(index) ? [index] : [],
      );
    later = controller;
    try {
      for (;;) {
        const pages = await next();
        if (pages.length === 0 || !current()) return;
        // A full reserve with every slot held: ranking this radio would add nothing.
        if (savedOffers.length >= PLAYLIST_SAVED_OFFERS && openSlots().length === 0) continue;
        if (yieldTurn !== undefined) await yieldTurn("free");
        if (!current()) return;
        const ranked = await rank(radiosInput(input, pages), controller.signal);
        if (!current()) return;
        saveOffers(
          playlistOffersWithSpares(
            savedOffers,
            ranked.map((offer) => offer.track),
          ),
        );
        const slots = [...state.slots];
        const open = openSlots();
        if (fillFromSpares(slots, open).length === open.length) continue;
        const unfilled = state.unfilled.filter((hole) => slots[hole] === null);
        publish({
          slots,
          unfilled,
          error: state.error === "refill" && unfilled.length === 0 ? null : state.error,
        });
      }
    } catch {
      // Stopped, or this ranking failed: the spares it would have added just don't come.
    } finally {
      if (later === controller) later = undefined;
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
        for (const hole of holes) {
          if (slots[hole] === null) slotWaitEnded(hole, "no offer");
          else slotWaitFilled(hole, "ranking");
        }
      } catch {
        // Paused or disposed mid-refill: the choices are saved, so their holes wait unfilled, without an error.
        leaveUnfilled(holes);
        // A failed save's message stays: its offer still waits for another try.
        if (!controller.signal.aborted && state.error !== "save") publish({ error: "refill" });
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
    // Its slot is filled: a renewal held for this tap runs behind it, with no one waiting.
    else void settle();
    return true;
  };
  const session = {
    get: () => state,
    dispose: () => {
      disposed = true;
      active?.abort();
      later?.abort();
      listeners.clear();
    },
    pause: () => {
      paused = true;
      active?.abort();
      later?.abort();
    },
    resume: () => {
      if (disposed) return;
      paused = false;
      if (!unheard) return;
      unheard = false;
      notify();
    },
    /** Whether a renewal is running behind the offers, or was held off and hasn't run. */
    renewalOwed: () => renewalPending || behind !== undefined || later !== undefined,
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
      if (unspared.length === 0) return;
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
     * it shows its loading, offers or failure: with [readFresh], the offers of the first
     * radio to answer, the others only adding spares, and the failure once no radio has
     * answered. It ends when the last radio has.
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
      later?.abort();
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
      /** Nothing showing yet: the section reads as loading, and Add and Dismiss wait. */
      let holding = !showing;
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
        const reading = async <T>(step: () => Promise<T>) => {
          const from = clock?.() ?? 0;
          try {
            return await step();
          } finally {
            if (clock !== undefined) readMs += clock() - from;
          }
        };
        /** Ranks [from] on its own turn, once it's had its frame; null if that's no longer wanted. */
        const ranking = async (from: PlaylistRecommendationSessionInput) => {
          if (yieldTurn !== undefined) await yieldTurn("paint");
          if (!current()) return null;
          const started = clock?.() ?? 0;
          try {
            const result = await rank(from, controller.signal);
            return current() ? result : null;
          } finally {
            if (clock !== undefined) rankMs += clock() - started;
          }
        };
        const { readFresh } = options;
        let input: PlaylistRecommendationSessionInput;
        let ranked: readonly PlaylistRecommendation[] | null = [];
        let laterRadios: (() => Promise<readonly RadioRankingPage[]>) | undefined;
        if (showing || readFresh === undefined) {
          input = await reading(() => read(controller.signal));
          if (!current()) return;
          ranked = await ranking(input);
          if (ranked === null) return;
        } else {
          const opened = await reading(() => readFresh(controller.signal));
          if (!current()) return;
          input = opened.input;
          const nextAnswers = radioAnswers(opened.radios, controller.signal);
          laterRadios = nextAnswers;
          let answered = false;
          // A radio with nothing eligible shows nothing: the next one to answer may.
          while (ranked.length === 0) {
            const pages = await reading(nextAnswers);
            if (!current()) return;
            if (pages.length === 0) break;
            answered = true;
            ranked = await ranking(radiosInput(input, pages));
            if (ranked === null) return;
          }
          if (!answered) {
            // Offline, or with nothing to seed a radio, no read failed: Library files can still join.
            if (opened.radios.length > 0 && input.sources.online !== false)
              throw new Error("No radio answered");
            ranked = await ranking(radiosInput(input, []));
            if (ranked === null) return;
          }
        }
        const offers = ranked;
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
            offers.map((offer) => offer.track),
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
        const reread = latestTracks(slots, offers, input.sources.library);
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
          const next = offers.find((candidate) => fits(candidate.track));
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
        if (laterRadios !== undefined) {
          // The owner's wait ends here: Add and Dismiss needn't wait for the other radios.
          holding = false;
          renewing = false;
          publish({ loading: false });
          await addSpares(laterRadios, input, current, controller);
        }
      } catch {
        if (current()) {
          const waited = waiting.splice(0);
          if (waited.length > 0) publish({ pendingSlots: pendingSlotsBut(waited) });
          if (!showing) publish({ error: "load" });
          timed(true);
        }
      } finally {
        if (behind === controller) behind = undefined;
        if (holding) {
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
