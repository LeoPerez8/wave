import {
  currentEntry,
  playingTrackIds,
  type MixedSong,
  type QueueContext,
  type QueueState,
  type YtSong,
} from "@wave/core";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import type { SongRow } from "@/library/LibraryStore";

import { playPage } from "./actions";
import { playbackState, type PlaybackState } from "./Player";
import { queueState } from "./Queue";
import { queuedYtSong, queueTracks } from "./queueTracks";
import { useLoadedLibraryFinder } from "@/ytmusic/libraryFinder";

export const usePlayback = (): PlaybackState =>
  useSyncExternalStore(playbackState.subscribe, playbackState.get);

/** Whether the player is playing (or about to, once buffered); position ticks don't re-render. */
export const usePlayWhenReady = (): boolean =>
  useSyncExternalStore(playbackState.subscribe, () => playbackState.get().playWhenReady);

export const useQueue = (): QueueState =>
  useSyncExternalStore(queueState.subscribe, queueState.get);

/** The track id of the current queue entry, if any (for highlighting the playing row). */
export const useCurrentTrackId = (): string | null =>
  useSyncExternalStore(queueState.subscribe, () => currentEntry(queueState.get())?.trackId ?? null);

/** All row identities of the playing recording, followed across a download. */
export const useCurrentPlayingIds = (): ReadonlySet<string> => {
  const currentId = useCurrentTrackId();
  const track = useSyncExternalStore(queueTracks.subscribe, () =>
    currentId === null ? null : (queueTracks.get().get(currentId) ?? null),
  );
  const song = useMemo(() => (track === null ? null : queuedYtSong(track)), [track]);
  const find = useLoadedLibraryFinder(song !== null);
  return useMemo(
    () => new Set(playingTrackIds(currentId, song, find ?? (() => null))),
    [currentId, song, find],
  );
};

/**
 * Play / Shuffle for a screen's songs, which may still be loading (a screen
 * shows its header before its query is done): pressed before they're read
 * ([songs] undefined), it plays them as soon as they are. What plays is
 * `playPage`'s: the mixed list in an integrated view, else the Library's songs.
 */
export const usePlayPage = (
  songs: readonly MixedSong<YtSong, SongRow>[] | undefined,
  context: QueueContext,
): ((shuffle: boolean) => void) => {
  /** The press waiting for the songs: shuffle or not; null for none. */
  const pending = useRef<boolean | null>(null);
  useEffect(() => {
    const shuffle = pending.current;
    if (songs === undefined || shuffle === null) return;
    pending.current = null;
    if (songs.length > 0) void playPage(songs, undefined, context, { shuffle });
  }, [songs, context]);
  return (shuffle) => {
    if (songs === undefined) pending.current = shuffle;
    else void playPage(songs, undefined, context, { shuffle });
  };
};
