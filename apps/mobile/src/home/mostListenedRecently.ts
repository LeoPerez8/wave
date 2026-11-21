import type { MagicQueueSeed } from "@wave/core";
import * as Effect from "effect/Effect";
import { useMemo } from "react";

import { LibraryStore } from "@/library/LibraryStore";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import type { PlayableSongRow } from "@wave/client";

import { readMostListenedRecently } from "./mostListenedRecentlyRead";
import { useLastDefined, useLocalDay } from "./useLocalDay";

const NONE: readonly MagicQueueSeed<PlayableSongRow>[] = [];

const read = (day: string) =>
  libraryQuery(
    `home:mostListenedRecently:${day}`,
    { tracks: true, plays: true },
    Effect.flatMap(LibraryStore, (store) => readMostListenedRecently(store, Date.now())).pipe(
      // A failed read leaves the page out; the Magic Queue page never waits on it.
      Effect.orElseSucceed(() => NONE),
    ),
  );

/**
 * The carousel's Most listened recently page (`readMostListenedRecently`):
 * its songs, none when the page is left out, or undefined until the first
 * read answers (and while [enabled] is off). Read from the phone alone. It
 * keeps what it last read while Home is out of sight, so coming back from
 * another screen repaints the same songs, and it re-reads only when plays or
 * songs changed (at most every 1.5 s in sight, once when Home comes back) or
 * the local day did, so the 14 days move on with nothing played.
 */
export const useMostListenedRecently = (
  enabled: boolean,
): readonly MagicQueueSeed<PlayableSongRow>[] | undefined => {
  const day = useLocalDay();
  const query = useMemo(() => read(day), [day]);
  const songs = useLastDefined(
    useLibraryQuery<readonly MagicQueueSeed<PlayableSongRow>[] | undefined>(
      enabled ? query : null,
      undefined,
    ),
  );
  return enabled ? songs : undefined;
};
