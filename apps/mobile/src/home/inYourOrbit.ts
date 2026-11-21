import { IN_YOUR_ORBIT_SONGS, type MagicQueueSeed } from "@wave/core";
import type { PlayableSongRow } from "@wave/client";

import { useMostListenedRecently } from "./mostListenedRecently";

/** Home's In your orbit: the carousel's shared recent ranking, shown only at nine songs. */
export const useInYourOrbit = (): readonly MagicQueueSeed<PlayableSongRow>[] | undefined => {
  const songs = useMostListenedRecently(true);
  return songs === undefined ? undefined : songs.length < IN_YOUR_ORBIT_SONGS ? [] : songs;
};
