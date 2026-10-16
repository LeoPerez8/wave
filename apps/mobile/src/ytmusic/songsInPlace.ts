import { NO_HELD_SONGS, songsInPlace, type HeldSongs, type SongsInPlace } from "@wave/core";
import { useEffect, useMemo } from "react";

import type { SongRow } from "@/library/LibraryStore";
import { useVisitState } from "@/lib/useVisitState";
import type { NativeYtSong } from "@/native/waveYtMusic";

import type { FindInLibrary } from "./libraryFinder";

/** A mixed list's YT Music rows, kept in place for the visit (Core's `songsInPlace`). */
export type PlacedSongs = SongsInPlace<NativeYtSong, SongRow, number>;

/** What a mixed list holds in place: read before its YT Music songs are picked. */
export interface HeldInPlace {
  readonly held: HeldSongs<NativeYtSong>;
  readonly hold: (next: HeldSongs<NativeYtSong>) => void;
}

/**
 * The YT Music songs a mixed list has shown streamed during this visit to
 * the screen (Core's `HeldSongs`); a new visit, or another [list] (Search's
 * query), holds nothing. Pass `held` to Core's `inLibraryUnlessHeld` where
 * the list picks its YT Music songs, then place them with `useSongsInPlace`.
 */
export const useHeldSongs = (list?: string): HeldInPlace => {
  const [held, hold] = useVisitState<HeldSongs<NativeYtSong>>(NO_HELD_SONGS, list);
  return useMemo(() => ({ held, hold }), [held, hold]);
};

const trackId = (track: SongRow): number => track.id;

const nowhere: FindInLibrary = () => null;

/**
 * The [streamed] YT Music songs a mixed list shows, kept in place for the
 * visit (Core's `songsInPlace`): a finished download stays in its row as the
 * Library's file, and the list's Library part leaves out `tracks`. What it
 * shows is held from then on. [find] is null until the Library is read.
 */
export const useSongsInPlace = (
  { held, hold }: HeldInPlace,
  streamed: readonly NativeYtSong[],
  find: FindInLibrary | null,
): PlacedSongs => {
  const placed = useMemo(
    () => songsInPlace(held, streamed, find ?? nowhere, trackId),
    [held, streamed, find],
  );
  useEffect(() => hold(placed.held), [hold, placed.held]);
  return placed;
};
