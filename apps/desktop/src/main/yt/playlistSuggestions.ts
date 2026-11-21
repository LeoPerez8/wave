/**
 * A playlist page's Recommended songs on the desktop (docs/spec.md, Playlist recommendations):
 * the phone's visit (`@wave/client/playlistSuggestionsVisit`) over main's Library, its seeds'
 * YouTube Music radios and the device settings. One visit at a time, the playlist page's, from
 * its first view until it closes or YT Music goes off.
 *
 * What the phone also weighs (the artist graph and genre lookups) isn't on the desktop yet, as
 * for the Magic Queue: its ranking uses the radios, the Library and the playlist's feedback.
 */
import { setImmediate } from "node:timers/promises";
import { makeExternalStore } from "@wave/client/externalStore";
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  acceptPlaylistRecommendation,
  dismissPlaylistRecommendation,
  selectPlaylistRecommendationInput,
} from "@wave/client/db/playlistRecommendations";
import { selectPlaylistEntries } from "@wave/client/db/playlists";
import {
  drawSuggestionSeeds,
  type SuggestionStorage,
} from "@wave/client/playlistSuggestionStorage";
import {
  createPlaylistSuggestionsVisit,
  type PlaylistSuggestionsHost,
  type PlaylistSuggestionsVisit,
} from "@wave/client/playlistSuggestionsVisit";
import type { SongRow } from "@wave/client";
import {
  goToSuggestionsOffered,
  type LibraryChange,
  type PlaylistRecommendationTrack,
  type PlaylistRefreshOutcome,
  type RadioRankingPage,
} from "@wave/core";
import { sql } from "drizzle-orm";

import type { BrowseRow } from "../../shared/browse.ts";
import type {
  PlaylistSuggestionSlot,
  PlaylistSuggestionsView,
} from "../../shared/playlistSuggestions.ts";
import { ytRow } from "../../shared/yt.ts";
import { browseSongs } from "../library/browse.ts";
import { preference, savePreference } from "../preferences.ts";
import { radioFirstPage } from "./magicQueue.ts";
import type { YtPagesShape } from "./ytPages.ts";

export interface PlaylistSuggestionsDeps {
  readonly db: LibraryDatabase;
  readonly pages: Pick<YtPagesShape, "songRadio" | "artistRadio" | "findSong" | "findArtist">;
  /** YT Music's setting: off, the section isn't shown and nothing is read. */
  readonly ytMusic: () => boolean;
  readonly online: () => boolean;
  /** The Library changed (an Add): the window reads it again. */
  readonly changed: () => void;
  /** A `WaveTiming` line. */
  readonly log: (line: string) => void;
}

export interface PlaylistSuggestionsShape {
  /** Playlist [playlistId]'s section, opening its visit; a change of [sources] renews it. */
  readonly view: (playlistId: number, sources: string) => PlaylistSuggestionsView;
  readonly add: (playlistId: number, key: string) => Promise<boolean>;
  readonly dismiss: (playlistId: number, key: string) => Promise<boolean>;
  readonly refresh: (playlistId: number) => Promise<PlaylistRefreshOutcome | null>;
  readonly retry: (playlistId: number, refill: boolean) => void;
  readonly close: (playlistId: number) => void;
}

/** The device settings, as the visit keeps its saved offers and seed draws in them. */
const settingsStorage = (db: LibraryDatabase): SuggestionStorage => ({
  getItem: (key) => preference(db, key) ?? null,
  setItem: (key, value) => savePreference(db, key, value),
  removeItem: (key) => {
    db.run(sql`DELETE FROM desktop_settings WHERE key=${key}`);
  },
});

/** How long ranking runs before main lets other calls in. */
const SLICE_MS = 8;

const nextTurn = async (): Promise<void> => {
  await setImmediate();
};

/** A streamed offer as the window's rows show it. */
const streamedRow = (track: PlaylistRecommendationTrack): BrowseRow =>
  ytRow({
    videoId: track.videoId,
    title: track.title,
    artists: track.artists,
    album: track.album,
    albumId: track.albumId,
    durationMs: track.durationMs,
    artworkUrl: track.artworkUrl,
    explicit: track.explicit,
  });

export const createPlaylistSuggestions = (
  deps: PlaylistSuggestionsDeps,
): PlaylistSuggestionsShape => {
  const storage = settingsStorage(deps.db);
  /** Each seed's radio this visit: its first page is read once. */
  const radios = new Map<string, Promise<RadioRankingPage | null>>();
  const radio = (
    visitId: string,
    seed: PlaylistRecommendationTrack,
  ): Promise<RadioRankingPage | null> => {
    const key = `${visitId}\n${seed.id}`;
    let read = radios.get(key);
    if (read === undefined) {
      read = radioFirstPage(deps.pages, {
        id: `song:${seed.id}`,
        title: seed.title,
        artists: seed.artists,
        durationMs: seed.durationMs,
        ...(seed.videoId === "" ? {} : { videoId: seed.videoId }),
      }).then(
        (page) =>
          page.status === "ok"
            ? { id: `song:${seed.id}`, artists: seed.artists, songs: page.songs }
            : null,
        () => null,
      );
      radios.set(key, read);
      // A failed read is asked again by the next renewal.
      void read.then((page) => {
        if (page === null) radios.delete(key);
      });
    }
    return read;
  };
  const listeners = new Set<(change: LibraryChange) => void>();
  const host: PlaylistSuggestionsHost = {
    storage,
    online: deps.online,
    now: () => performance.now(),
    read: async (playlistId, signal) => {
      signal.throwIfAborted();
      const input = selectPlaylistRecommendationInput(deps.db, playlistId);
      const songById = new Map<string, SongRow>(
        input.librarySongs.map((song) => [String(song.id), song]),
      );
      return { ...input, songById };
    },
    graph: async () => null,
    seeds: (playlistId, playlist) => drawSuggestionSeeds(storage, playlistId, playlist),
    radios: async (visitId, seeds, when, signal) => {
      // Main keeps no radio pages between launches: offline there is none to read.
      if (!when.online) return [];
      const pages = await Promise.all(seeds.map((seed) => radio(visitId, seed)));
      signal.throwIfAborted();
      return pages.flatMap((page) => (page === null ? [] : [page]));
    },
    steps: async (steps, _awaited, signal) => {
      let started = performance.now();
      for (;;) {
        signal?.throwIfAborted();
        const next = steps.next();
        if (next.done) return next.value;
        if (performance.now() - started > SLICE_MS) {
          await nextTurn();
          started = performance.now();
        }
      }
    },
    accept: async (playlistId, offer) =>
      acceptPlaylistRecommendation(deps.db, playlistId, offer, Date.now()),
    dismiss: async (playlistId, offer) =>
      dismissPlaylistRecommendation(deps.db, playlistId, offer, Date.now()),
    accepted: () => deps.changed(),
    log: deps.log,
    afterPaint: nextTurn,
    freeTurn: nextTurn,
    // The window asks once its page has painted: there's nothing to wait for.
    settle: async () => {},
    changes: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  let open: {
    readonly playlistId: number;
    readonly visit: PlaylistSuggestionsVisit;
    readonly stop: () => void;
    sources: string;
    /** What each tapped slot's Add or Dismiss is, until it ends. */
    readonly busy: Map<number, { readonly action: "add" | "dismiss"; readonly title: string }>;
  } | null = null;

  const close = (): void => {
    if (open === null) return;
    open.stop();
    // The next visit reads its radios afresh.
    radios.clear();
    open = null;
  };
  const visitOf = (playlistId: number) =>
    open !== null && open.playlistId === playlistId && deps.ytMusic() ? open : null;

  const act = async (playlistId: number, key: string, action: "add" | "dismiss") => {
    const current = visitOf(playlistId);
    if (current === null) return false;
    const { session } = current.visit;
    const index = session.get().slots.findIndex((offer) => offer?.key === key);
    const offer = session.get().slots[index];
    if (offer == null) return false;
    const acting = action === "add" ? session.accept(key) : session.dismiss(key);
    // The session publishes the slot's placeholder at once when it takes the tap.
    if (!session.get().pending.includes(key)) return false;
    current.busy.set(index, { action, title: offer.track.title });
    try {
      return (await acting) === true;
    } finally {
      current.busy.delete(index);
    }
  };

  return {
    view: (playlistId, sources) => {
      if (!deps.ytMusic()) {
        close();
        return { shown: false };
      }
      if (open?.playlistId !== playlistId) {
        close();
        const visit = createPlaylistSuggestionsVisit(playlistId, host);
        const always = makeExternalStore(true);
        const stop = visit.follow(
          { visible: () => true, subscribe: () => () => {} },
          always,
          makeExternalStore<number | null>(null),
        );
        open = { playlistId, visit, stop, sources, busy: new Map() };
      } else if (open.sources !== sources) {
        open.sources = sources;
        try {
          open.visit.playlistRead(selectPlaylistEntries(deps.db, playlistId));
        } catch {
          // The playlist is gone: the renewal's read says so.
        }
        const change: LibraryChange = { kind: "playlists", ids: [playlistId] };
        for (const listener of listeners) listener(change);
      }
      const { session } = open.visit;
      const state = session.get();
      const libraryIds = state.slots.flatMap((offer) =>
        offer?.track.source === "library" ? [Number(offer.track.id)] : [],
      );
      const rows = new Map(browseSongs(deps.db, libraryIds).map((row) => [row.id, row]));
      const busy = open.busy;
      const slots = state.slots.flatMap((offer, index): PlaylistSuggestionSlot[] => {
        if (state.pendingSlots.includes(index)) {
          const tapped = busy.get(index);
          return [{ kind: "busy", action: tapped?.action ?? null, title: tapped?.title ?? null }];
        }
        if (offer === null) return state.unfilled.includes(index) ? [{ kind: "unfilled" }] : [];
        const row =
          offer.track.source === "library"
            ? rows.get(Number(offer.track.id))
            : streamedRow(offer.track);
        return row === undefined ? [] : [{ kind: "offer", key: offer.key, row }];
      });
      return {
        shown: true,
        loading: state.loading,
        error: state.error,
        slots,
        offered: goToSuggestionsOffered(state),
      };
    },
    add: (playlistId, key) => act(playlistId, key, "add"),
    dismiss: (playlistId, key) => act(playlistId, key, "dismiss"),
    refresh: async (playlistId) => {
      const current = visitOf(playlistId);
      return current === null ? null : current.visit.session.refresh();
    },
    retry: (playlistId, refill) => {
      const current = visitOf(playlistId);
      if (current === null) return;
      void current.visit.session
        .renew(refill ? { refillOnly: true } : { turn: "paint" })
        .catch(() => {});
    },
    close: (playlistId) => {
      if (open?.playlistId === playlistId) close();
    },
  };
};
