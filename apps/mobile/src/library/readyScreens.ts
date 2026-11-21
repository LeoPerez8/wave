/**
 * The local screens' data, kept ready in memory before they're opened
 * (#1352, Fluidity): opening the Library's pages, a playlist, a genre or
 * Settings › Library draws what memory holds and reads nothing first. A
 * startup job after the first screen settles (`app/_layout.tsx`) keeps each
 * query on its own free turn of the background scheduler (#1350); from then
 * on Core's registry re-reads them as the Library changes (`keep`), so the
 * next open shows the new data.
 *
 * Albums and artists need nothing here: their pages are drawn from the
 * Library's rows Search's index already holds (`libraryMemory.ts`). Home
 * (#1353) adds its own queries with `keepReady`.
 *
 * Bounds (Performance rule 12):
 * - `readyLibraryQueries`: one list or count each (Albums, Artists, Genres,
 *   Playlists, Favorites, missing songs, music and excluded folders, the
 *   Library's counts), plus Songs' order in its saved sort: ids, not rows.
 * - `PLAYLISTS_AHEAD` playlists ahead, collaborative ones first, each of at
 *   most `PLAYLIST_ENTRIES_AHEAD` entries; longer ones only once opened.
 * - `GENRES_AHEAD` genre openings (a header and a first page each).
 * - `RECENT_SCREENS_KEPT` pushed screens opened last (`keepRecentlyOpened`).
 * - Settings › Disliked songs' list (one row per dislike), read again on a
 *   free turn when the dislikes change; Stats' opening period (`STATS_KEPT`
 *   readings, a few dozen rows each); DJ's opening for the last snapshot;
 *   Settings › History's head (`HISTORY_KEPT_ROWS` plays); the saved YouTube
 *   Music answers of `ARTIST_PAGES_AHEAD` most played artists, within
 *   `knownYtArtists`' 16.
 */
import { identityKey, librarySongSort } from "@wave/core";

import { listCollaborations } from "@/collaboration/collaborativePlaylists";
import { prepareDjOpening } from "@/dj/djOpening";
import { freeTurn, whenFree } from "@/lib/backgroundWork";
import { currentLocalisation } from "@/localisation/localisation";
import { readStatsOpening, statsOpeningArtists } from "@/stats/hooks";
import { readSaved } from "@/ytmusic/artistSection";
import { registerPerfMeta } from "@/perf/perf";

import { noticesQuery } from "./collaborativePlaylists";
import { readDislikedSongs } from "./dislikedSongList";
import { onDislikesChanged } from "./dislikes";
import { readListeningHistoryHead } from "./useListeningHistory";
import { genreOpeningQuery } from "./genreOpening";
import { libraryListQueries, playlistQuery, readyLibraryQueries } from "./hooks";
import { songOrderQuery } from "./pagedSongs";
import { playlistsLastPlayedQuery } from "./playlistSort";
import { appRuntime } from "./runtime";
import { keepLibraryQuery, libraryQueryResult, type LibraryQuery } from "./sharedQueries";
import { settingSongSortNow } from "./songSort";

/** Playlists whose page is kept ahead. */
export const PLAYLISTS_AHEAD = 8;
/** A playlist longer than this is kept only once opened. */
export const PLAYLIST_ENTRIES_AHEAD = 1000;
/**
 * Library artists whose saved YouTube Music answer (Fans might also like,
 * About) is read ahead into this session's answers (`knownYtArtists`, 16 at
 * most): the opening period's most played.
 */
export const ARTIST_PAGES_AHEAD = 8;
/** Genres whose opening is kept ahead, the first in Library › Genres. */
export const GENRES_AHEAD = 12;

const releases: (() => void)[] = [];
let started = false;
let stopped = false;

/** Keeps [queries] ready, one per free turn, in order (#1353 adds Home's). */
export const keepReady = (name: string, queries: readonly LibraryQuery<unknown>[]): void => {
  const queue = [...queries];
  const next = (): void => {
    if (stopped) return;
    const query = queue.shift();
    if (query === undefined) return;
    releases.push(keepLibraryQuery(query));
    if (queue.length > 0) whenFree(next, name);
  };
  whenFree(next, name);
};

/** The playlists kept ahead: collaborative ones first, then the list's first, none too long. */
const playlistsAhead = async (): Promise<readonly number[]> => {
  const [playlists, collaborations] = await Promise.all([
    libraryQueryResult(libraryListQueries.playlists),
    libraryQueryResult(listCollaborations),
  ]);
  const short = new Set(
    (playlists ?? [])
      .filter((playlist) => playlist.trackCount <= PLAYLIST_ENTRIES_AHEAD)
      .map((playlist) => playlist.id),
  );
  const shared = (collaborations ?? []).flatMap((row) =>
    row.playlistId !== null && short.has(row.playlistId) ? [row.playlistId] : [],
  );
  const ids = [...new Set([...shared, ...short])];
  return ids.slice(0, PLAYLISTS_AHEAD);
};

/** The genres whose opening is kept ahead, in the genre screens' saved sort. */
const genresAhead = async (): Promise<readonly LibraryQuery<unknown>[]> => {
  const genres = (await libraryQueryResult(libraryListQueries.genres)) ?? [];
  const sort = librarySongSort(settingSongSortNow("genre"));
  return genres
    .slice(0, GENRES_AHEAD)
    .map((genre) => genreOpeningQuery(genre.id, sort) as LibraryQuery<unknown>);
};

/** Starts keeping the local screens' data; returns how to let it all go. */
export const startReadyScreens = (): (() => void) => {
  if (started) return () => {};
  started = true;
  stopped = false;
  keepReady("Library pages", [
    ...readyLibraryQueries,
    songOrderQuery(librarySongSort(settingSongSortNow("songs"))) as LibraryQuery<unknown>,
    listCollaborations as LibraryQuery<unknown>,
    noticesQuery as LibraryQuery<unknown>,
    playlistsLastPlayedQuery as LibraryQuery<unknown>,
  ]);
  void playlistsAhead().then((ids) => {
    if (!stopped)
      keepReady(
        "Playlist pages",
        ids.map((id) => playlistQuery(id) as LibraryQuery<unknown>),
      );
  });
  void genresAhead().then((queries) => {
    if (!stopped) keepReady("Genre pages", queries);
  });
  // Settings › Disliked songs, read now and again on a free turn after each change.
  const readDislikes = (): void => {
    if (!stopped) void readDislikedSongs().catch(() => {});
  };
  whenFree(readDislikes, "Disliked songs page");
  releases.push(onDislikesChanged(() => whenFree(readDislikes, "Disliked songs page")));
  whenFree(() => {
    if (stopped) return;
    const { language } = currentLocalisation();
    void readStatsOpening(language, () => freeTurn("Stats page")).then(async () => {
      // The most played artists' pages draw Fans might also like and About in their first frame.
      const names = statsOpeningArtists(language)
        .flatMap(({ item }) => ("albumCount" in item ? [item.name] : []))
        .slice(0, ARTIST_PAGES_AHEAD);
      for (const name of names) {
        await freeTurn("Artist pages");
        if (stopped) return;
        await appRuntime.runPromise(readSaved(identityKey(name))).catch(() => null);
      }
    });
  }, "Stats page");
  whenFree(() => {
    if (!stopped) void prepareDjOpening().catch(() => {});
  }, "DJ opening");
  whenFree(() => {
    if (!stopped) void readListeningHistoryHead().catch(() => {});
  }, "History page");
  return () => {
    stopped = true;
    started = false;
    for (const release of releases.splice(0)) release();
  };
};

registerPerfMeta("readyScreens", () => ({ kept: releases.length }));
