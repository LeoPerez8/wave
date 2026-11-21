/**
 * A playlist visit's suggestions: the session, and what it holds, belong to the
 * visit rather than to the list's footer, so they load from the opening on and
 * outlive the section scrolling out of sight or being recycled away. The phone and
 * the desktop each give it a host: where it reads, ranks, saves and logs.
 */
import {
  PLAYLIST_SAVED_OFFERS,
  playlistOfferGoneSteps,
  playlistOfferHeld,
  playlistOffersAwaited,
  playlistRecommendationsSteps,
  playlistRecommendationSession,
  playlistReserveRefillLine,
  playlistSlotWaitLine,
  playlistSuggestionsLine,
  playlistSuggestionsSightLine,
  playlistSuggestionsSightWatch,
  type ArtistGraph,
  type LibraryChange,
  type PlaylistRecommendationSessionInput,
  type PlaylistRecommendationSlot,
  type PlaylistRecommendationSources,
  type PlaylistRecommendationTrack,
  type RadioRankingPage,
} from "@wave/core";

import { makeExternalStore, type ExternalStore } from "./externalStore.ts";
import { followPlaylistRecommendations } from "./playlistSuggestionsFollow.ts";
import {
  readSavedOffers,
  writeSavedOffers,
  type SuggestionStorage,
} from "./playlistSuggestionStorage.ts";
import { sightOf, type ScreenSight } from "./sight.ts";
import type { PlaylistEntryRow, SongRow } from "./types.ts";

/** A playlist's own read: its entries, the Library and its feedback, with the Library's rows. */
export interface PlaylistSuggestionsRead extends Omit<
  PlaylistRecommendationSources,
  "pages" | "seeds" | "graph" | "profileOf" | "online"
> {
  readonly playlist: readonly PlaylistRecommendationTrack[];
  /** The Library's rows by track id: the visit keeps those of its offers. */
  readonly songById: ReadonlyMap<string, SongRow>;
}

/** Where a visit reads, ranks, saves and logs: the phone's services, or the desktop's. */
export interface PlaylistSuggestionsHost {
  /** Where the saved offers and the seed draws are kept, on the device. */
  readonly storage: SuggestionStorage;
  readonly online: () => boolean;
  /** The clock the timing lines use. */
  readonly now: () => number;
  /** Playlist [playlistId]'s read, its last completed one when the host keeps one. */
  readonly read: (playlistId: number, signal: AbortSignal) => Promise<PlaylistSuggestionsRead>;
  /** The artist graph's last derivation, null before the first or without one. */
  readonly graph: (signal: AbortSignal) => Promise<ArtistGraph | null>;
  readonly profileOf?: PlaylistRecommendationSources["profileOf"];
  /** The seeds a renewal reads radios for, drawn from [playlist]. */
  readonly seeds: (
    playlistId: number,
    playlist: readonly PlaylistRecommendationTrack[],
  ) => readonly PlaylistRecommendationTrack[];
  /** [seeds]' radios for visit [visitId]: one page each that answered, music videos left out. */
  readonly radios: (
    visitId: string,
    seeds: readonly PlaylistRecommendationTrack[],
    when: { readonly online: boolean; readonly low: boolean },
    signal: AbortSignal,
  ) => Promise<readonly RadioRankingPage[]>;
  /** Runs Core's ranking [steps], at the pace [awaited] asks for. */
  readonly steps: <A>(
    steps: Generator<void, A>,
    awaited: () => boolean,
    signal?: AbortSignal,
  ) => Promise<A>;
  readonly accept: (playlistId: number, offer: PlaylistRecommendationSlot) => Promise<boolean>;
  readonly dismiss: (playlistId: number, offer: PlaylistRecommendationSlot) => Promise<unknown>;
  /** An Add joined the playlist: changes it notifies while this runs don't renew the visit. */
  readonly accepted: (playlistId: number) => void;
  /** A `WaveTiming` line. */
  readonly log: (line: string) => void;
  /** Resolves once what was just published has had a frame to paint. */
  readonly afterPaint: () => Promise<void>;
  /** Resolves on a free turn, when rendering has had its frame. */
  readonly freeTurn: () => Promise<void>;
  /** Resolves once the screen has settled after the opening, or its wait ran out. */
  readonly settle: (signal: AbortSignal) => Promise<void>;
  /** The Library's changes, as they happen; returns how to stop. */
  readonly changes: (listener: (change: LibraryChange) => void) => () => void;
}

let nextOffer = 0;

/** The last ranking found fewer new suggestions than this: the next read adds next pages. */
const LOW = 10;

const entryLibraryId = (entry: PlaylistEntryRow) =>
  entry.source === "library" ? String(entry.track.id) : undefined;
const entryVideoId = (entry: PlaylistEntryRow) =>
  entry.source === "stream" ? entry.song.videoId : undefined;

/** The rows the read behind [input] brought: the session passes a read's sources along as they are. */
const rowsOfInput = ({ sources }: PlaylistRecommendationSessionInput) =>
  (sources as typeof sources & { readonly songById: ReadonlyMap<string, SongRow> }).songById;

/** The visit proper, from the first moment its section is wanted; [openingAt], the playlist's opening. */
const openPlaylistSuggestionsVisit = (
  playlistId: number,
  openingAt: number,
  host: PlaylistSuggestionsHost,
) => {
  const announcingAcceptance = makeExternalStore(false);
  // What a tapped slot's placeholder says until its action ends ("Adding Song"), by slot;
  // any other placeholder is loading a replacement.
  const busyLabels = makeExternalStore<ReadonlyMap<number, string>>(new Map());
  // Keep held offers readable if another offer's refill no longer finds their Library row.
  const saved = readSavedOffers(host.storage, playlistId);
  // The rows of what's saved, spares among them, whichever read last held them.
  let savedRows = saved.rows;
  const libraryRows = makeExternalStore<ReadonlyMap<string, SongRow>>(saved.rows);
  const latestRows = makeExternalStore<ReadonlyMap<string, SongRow>>(new Map());
  // Date.now(): the list notices the section's sight on the UI thread, whose clock is this one.
  const sightWatch = playlistSuggestionsSightWatch({
    now: Date.now,
    report: (timing) => host.log(playlistSuggestionsSightLine(timing)),
  });
  // The first renewal is the one opening the playlist asked for; its line counts from here.
  let openedAt: number | undefined = openingAt;
  // This visit's radio readers: each radio's live first page is read once a visit.
  const visitId = `playlist:${playlistId}:${Date.now().toString(36)}-${++nextOffer}`;
  let remaining = Number.POSITIVE_INFINITY;
  // Before the settle wait ends only a tap with no spare reads: its owner is waiting on the
  // placeholder. A low reserve's refill, or a slot an offer left, waits for the renewal.
  let settled = false;
  const rowOf = (id: string) =>
    latestRows.get().get(id) ?? libraryRows.get().get(id) ?? savedRows.get(id);
  const readSources = async (signal: AbortSignal) => {
    const input = await host.read(playlistId, signal);
    const graph = await host.graph(signal);
    const seeds = host.seeds(playlistId, input.playlist);
    const online = host.online();
    return {
      input: {
        playlist: input.playlist,
        sources: {
          ...input,
          pages: [],
          seeds,
          graph,
          ...(host.profileOf === undefined ? {} : { profileOf: host.profileOf }),
          online,
        },
      },
      when: { online, low: remaining < LOW },
    };
  };
  /** Whether someone waits is asked at each slice: a tap can start a wait mid-ranking. */
  const awaited = () => playlistOffersAwaited(session.get());
  const session = playlistRecommendationSession({
    settled: () => settled,
    saved: {
      offers: saved.tracks,
      online: host.online,
      write: (offers) => {
        const rows = new Map<string, SongRow>();
        for (const { id } of offers) {
          const row = rowOf(id);
          if (row !== undefined) rows.set(id, row);
        }
        savedRows = rows;
        writeSavedOffers(host.storage, playlistId, offers, (id) => rows.get(id));
      },
    },
    gone: (input, signal) =>
      host.steps(playlistOfferGoneSteps(input.playlist, input.sources), awaited, signal),
    newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++nextOffer}`,
    read: async (signal = new AbortController().signal) => {
      sightWatch.waiting("read");
      const { input, when } = await readSources(signal);
      const pages = await host.radios(visitId, input.sources.seeds, when, signal);
      sightWatch.waiting(null);
      return { ...input, sources: { ...input.sources, pages } };
    },
    // Each radio on its own: the session shows offers from the first to answer.
    readFresh: async (signal = new AbortController().signal) => {
      sightWatch.waiting("read");
      const { input, when } = await readSources(signal);
      return {
        input,
        radios: () =>
          input.sources.seeds.map((seed) =>
            host.radios(visitId, [seed], when, signal).then((pages) => pages[0] ?? null),
          ),
      };
    },
    rank: async (input, signal) => {
      sightWatch.waiting("rank");
      const ranked = await host.steps(
        playlistRecommendationsSteps(input.playlist, input.sources, PLAYLIST_SAVED_OFFERS),
        awaited,
        signal,
      );
      sightWatch.waiting(null);
      remaining = ranked.length;
      const held = new Map<string, SongRow>();
      // The read's whole rows live only as long as its input: the visit keeps these few.
      const rows = rowsOfInput(input);
      const keep = (id: string) => {
        const row = rows.get(id);
        if (row !== undefined) held.set(id, row);
      };
      for (const offer of ranked) keep(offer.track.id);
      for (const offer of session.get().slots) if (offer !== null) keep(offer.track.id);
      latestRows.set(held);
      // The rows showing take what was just read, offers the ranking dropped among them.
      libraryRows.update((previous) => {
        if (![...previous].some(([id, row]) => (held.get(id) ?? row) !== row)) return previous;
        return new Map([...previous].map(([id, row]) => [id, held.get(id) ?? row]));
      });
      return ranked;
    },
    dismiss: (offer) => host.dismiss(playlistId, offer),
    accept: (offer) =>
      host.accept(playlistId, offer).then((added) => {
        if (added) {
          // The host's notification is synchronous; this Add already refills its slot.
          announcingAcceptance.set(true);
          try {
            host.accepted(playlistId);
          } finally {
            announcingAcceptance.set(false);
          }
        }
        return added;
      }),
    // The tap's placeholder paints before the write; the replacement's read
    // gives rendering its frame when due (Core's `PlaylistRecommendationTurn`).
    yieldTurn: (kind) => (kind === "paint" ? host.afterPaint() : host.freeTurn()),
    timed: {
      now: host.now,
      report: (timing) => {
        const sinceOpen = openedAt === undefined ? undefined : host.now() - openedAt;
        openedAt = undefined;
        host.log(playlistSuggestionsLine(timing, sinceOpen));
        const { offers, failed } = timing;
        void host.afterPaint().then(() => sightWatch.shown({ offers, failed }));
      },
      slotWait: (wait) => host.log(playlistSlotWaitLine(wait)),
      reserveRefill: (refill) => host.log(playlistReserveRefillLine(refill)),
    },
  });
  // Saved offers are showing from the start: the wait for them is over, and what runs next renews.
  const shownAtOnce = session.get().slots.length;
  if (shownAtOnce > 0) {
    openedAt = undefined;
    sightWatch.shown({ offers: shownAtOnce, failed: false });
  }
  // Here, not in the section: slots can change with the section unmounted.
  let heldSlots = session.get().slots;
  session.subscribe(() => {
    const { slots } = session.get();
    if (slots === heldSlots) return;
    heldSlots = slots;
    libraryRows.update((previous) => {
      const held = new Map<string, SongRow>();
      const wanted = new Set(
        slots.flatMap((offer) => (offer?.track.source === "library" ? [offer.track.id] : [])),
      );
      // At most five lookups; don't synchronously index/copy the complete source on publication.
      for (const id of wanted) {
        const row = latestRows.get().get(id) ?? previous.get(id) ?? savedRows.get(id);
        if (row !== undefined) held.set(id, row);
      }
      return held;
    });
  });
  return {
    session,
    libraryRows,
    busyLabels,
    /**
     * The playlist's entries as just read: an offer it now holds leaves, and only its
     * slot fills. Other recordings of the song leave once a renewal's read has found them.
     */
    playlistRead: (items: readonly PlaylistEntryRow[]): void => {
      const offers = session.offers();
      if (offers.length === 0) return;
      session.leave(playlistOfferHeld(offers, items, entryLibraryId, entryVideoId));
    },
    /**
     * Loads while [screen] is in sight and the section is [wanted]; the section's
     * own sight only times the wait. Returns how to stop, cancelling what's under way.
     */
    follow: (
      screen: ScreenSight,
      wanted: Pick<ExternalStore<boolean>, "get" | "subscribe">,
      sectionSight: Pick<ExternalStore<number | null>, "get" | "subscribe">,
    ): (() => void) => {
      const sight = sightOf(
        { holds: screen.visible, subscribe: screen.subscribe },
        {
          holds: wanted.get,
          subscribe: (listener) => wanted.subscribe(() => listener(wanted.get())),
        },
      );
      const following = followPlaylistRecommendations(session, {
        playlistId,
        sight,
        start: (signal) => {
          sightWatch.waiting("settle");
          return host.settle(signal).then(() => {
            settled = true;
          });
        },
        // The visit follows the write's cause (#599): source changes revalidate even when
        // playlist IDs stay the same, once the playlist is in sight and settled. Catalog writes
        // (its own radios' among them) don't: the suggestions read their radios, not the catalog.
        subscribe: host.changes,
        ignore: (change) => change.kind === "playlists" && announcingAcceptance.get(),
      });
      // Now Playing or Find over a wait starts it over.
      const listSight = () => {
        const at = sectionSight.get();
        if (at !== null && sight.visible()) sightWatch.inSight(at);
      };
      listSight();
      const stopList = sectionSight.subscribe(listSight);
      const stopSight = sight.subscribe((visible) => {
        if (!visible) sightWatch.hidden();
        else if (sectionSight.get() !== null) sightWatch.inSight();
      });
      return () => {
        following.dispose();
        stopList();
        stopSight();
      };
    },
  };
};

/**
 * A playlist visit's suggestions, costing nothing until they're wanted: its saved offers are
 * read, and its session made, the first time something asks for them or its section is wanted.
 * With YT Music off, or Find or selection open throughout, that's never.
 */
export const createPlaylistSuggestionsVisit = (
  playlistId: number,
  host: PlaylistSuggestionsHost,
) => {
  const openingAt = host.now();
  let opened: ReturnType<typeof openPlaylistSuggestionsVisit> | undefined;
  const open = () => (opened ??= openPlaylistSuggestionsVisit(playlistId, openingAt, host));
  return {
    get session() {
      return open().session;
    },
    get libraryRows() {
      return open().libraryRows;
    },
    get busyLabels() {
      return open().busyLabels;
    },
    playlistRead: (items: readonly PlaylistEntryRow[]): void => open().playlistRead(items),
    /** See the visit's own; while [wanted] hasn't held yet, it only waits for it. */
    follow: (
      screen: ScreenSight,
      wanted: Pick<ExternalStore<boolean>, "get" | "subscribe">,
      sectionSight: Pick<ExternalStore<number | null>, "get" | "subscribe">,
    ): (() => void) => {
      if (wanted.get()) return open().follow(screen, wanted, sectionSight);
      let stop: (() => void) | undefined;
      const stopWaiting = wanted.subscribe(() => {
        if (wanted.get()) stop ??= open().follow(screen, wanted, sectionSight);
      });
      return () => {
        stopWaiting();
        stop?.();
      };
    },
  };
};

export type PlaylistSuggestionsVisit = ReturnType<typeof createPlaylistSuggestionsVisit>;
