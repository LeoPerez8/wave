import { STATS_TOP } from "@wave/core";

import { libraryQuery, useLibraryQuery } from "@/library/hooks";
import { LibraryStore } from "@/library/LibraryStore";
import { topAlbumsAndArtists, type TopAlbumsAndArtists } from "@/stats/Stats";

/** How many artists Most played artists shows; Most played albums shows a Stats top. */
const MOST_PLAYED_ARTISTS = 5;

const readMostPlayed = libraryQuery(
  "home:mostPlayedOfAllTime",
  { tracks: true, plays: true },
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) => topAlbumsAndArtists(store, "all", STATS_TOP, MOST_PLAYED_ARTISTS)),
);

/**
 * Home's Most played albums and artists: Stats' all-time rankings (so the
 * order matches Library › Stats), read once for both sections from the play
 * totals, or undefined while it first loads. Plays re-read it at most every
 * 1.5 s while Home is in sight, and once when Home comes back.
 */
export const useMostPlayedOfAllTime = (): TopAlbumsAndArtists | undefined =>
  useLibraryQuery<TopAlbumsAndArtists | undefined>(readMostPlayed, undefined);
