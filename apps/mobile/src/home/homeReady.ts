/**
 * Home's reads kept ready in memory from startup (#1353, built on #1352's
 * `keepReady`): coming back to Home, or a section mounting, draws what memory
 * holds and reads nothing first. Home's own lists, its Stats facts and the
 * Library's counts are kept with the Library's pages (`readyLibraryQueries`:
 * `readHomeAdded`, `readHomePlays`, `readHomeFavorites`, `readListeningSums`).
 *
 * Bounds (Performance rule 12): Most played albums and artists (a Stats top
 * and five artists), From your library (the playlists' rows) and In your
 * orbit's ranking (at most nine songs shown, from one recent ranking), each
 * one query for today's local day. The Magic Queue's pages are kept for the
 * session where they're drawn (`keptPages`, three pages of nine) and are the
 * snapshot's at a cold start.
 */
import { localDay } from "@wave/core";

import type { LibraryQuery } from "@/library/sharedQueries";
import { dontPlayExplicit } from "@/settings/dontPlayExplicit";

import { fromYourLibraryQuery } from "./fromYourLibrary";
import { mostListenedRecentlyQuery } from "./mostListenedRecently";
import { readMostPlayed } from "./mostPlayedOfAllTime";

/** Home's queries to keep, for today's local day and Don't play explicit as it is now. */
export const homeReadyQueries = (): readonly LibraryQuery<unknown>[] => {
  const day = localDay(Date.now());
  return [
    mostListenedRecentlyQuery(day, dontPlayExplicit()),
    readMostPlayed,
    fromYourLibraryQuery(day),
  ] as readonly LibraryQuery<unknown>[];
};
