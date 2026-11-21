import type { MagicQueueSeed } from "@wave/core";
import * as Effect from "effect/Effect";
import { useMemo } from "react";

import { LibraryStore } from "@/library/LibraryStore";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import { useDontPlayExplicit } from "@/settings/dontPlayExplicit";
import type { PlayableSongRow } from "@wave/client";

import { readMostListenedRecently } from "./mostListenedRecentlyRead";
import { useLastDefined, useLocalDay } from "./useLocalDay";

const NONE: readonly MagicQueueSeed<PlayableSongRow>[] = [];

/**
 * In your orbit's read for the local [day], with explicit streamed songs
 * passed over when [explicit]; kept ready from startup (`homeReady.ts`).
 */
export const mostListenedRecentlyQuery = (day: string, explicit: boolean) =>
  libraryQuery(
    `home:mostListenedRecently:${day}:${explicit ? "clean" : "all"}`,
    { tracks: true, plays: true },
    Effect.flatMap(LibraryStore, (store) =>
      readMostListenedRecently(store, Date.now(), explicit),
    ).pipe(
      // A failed read leaves the page out; the Magic Queue page never waits on it.
      Effect.orElseSucceed(() => NONE),
    ),
  );

/**
 * In your orbit's most listened recent songs (`readMostListenedRecently`):
 * its songs, none when too few rank, or undefined until the first
 * read answers (and while [enabled] is off). Read from the phone alone. It
 * keeps what it last read while Home is out of sight, so coming back from
 * another screen repaints the same songs, and it re-reads only when plays or
 * songs changed (at most every 1.5 s in sight, once when Home comes back) or
 * the local day did, so the 14 days move on with nothing played. With Don't
 * play explicit on, explicit streamed songs are passed over.
 */
export const useMostListenedRecently = (
  enabled: boolean,
): readonly MagicQueueSeed<PlayableSongRow>[] | undefined => {
  const day = useLocalDay();
  const explicit = useDontPlayExplicit();
  const query = useMemo(() => mostListenedRecentlyQuery(day, explicit), [day, explicit]);
  const songs = useLastDefined(
    useLibraryQuery<readonly MagicQueueSeed<PlayableSongRow>[] | undefined>(
      enabled ? query : null,
      undefined,
    ),
  );
  return enabled ? songs : undefined;
};
