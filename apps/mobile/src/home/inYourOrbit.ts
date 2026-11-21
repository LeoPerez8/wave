import { inYourOrbitSongs, inYourOrbitTap, type MagicQueueSeed } from "@wave/core";
import type { PlayableSongRow } from "@wave/client";
import { useMemo } from "react";

import { playSongs } from "@/playback/actions";
import { ytMusicEnabled } from "@/settings/ytMusic";

import { startMagicQueueFrom, startStreamedMagicQueueFrom } from "./magicQueueSection";
import { useSnapshotted } from "./homeSnapshot";
import { useMostListenedRecently } from "./mostListenedRecently";

/** Songs played from In your orbit with YT Music off are queued from it. */
const IN_YOUR_ORBIT_CONTEXT = { kind: "home", id: "in-your-orbit" } as const;

/**
 * Home's In your orbit: the carousel's shared recent ranking
 * (`mostListenedRecentlyQuery`), shown only at nine songs (Core's
 * `inYourOrbitSongs`). At a cold start, the snapshot's until the first read
 * answers.
 */
export const useInYourOrbit = (): readonly MagicQueueSeed<PlayableSongRow>[] | undefined => {
  const songs = useMostListenedRecently(true);
  // The same tiles until the songs change: the grid takes them (#1423).
  const tiles = useMemo(() => (songs === undefined ? undefined : inYourOrbitSongs(songs)), [songs]);
  return useSnapshotted("orbit", tiles);
};

/**
 * A tap on In your orbit's tile at [index] of [tiles] (Core's
 * `inYourOrbitTap`): a Magic Queue from its song, or with YT Music off the
 * grid's Library songs played from it.
 */
export const tapInYourOrbit = (
  tiles: readonly MagicQueueSeed<PlayableSongRow>[],
  index: number,
): void => {
  const tap = inYourOrbitTap(tiles, index, ytMusicEnabled());
  if (tap.kind === "play") void playSongs(tap.songs, tap.start, IN_YOUR_ORBIT_CONTEXT);
  else if (tap.kind === "magicQueue") {
    if (tap.seed.source === "library") startMagicQueueFrom(tap.seed.song);
    else startStreamedMagicQueueFrom(tap.seed.song);
  }
};
