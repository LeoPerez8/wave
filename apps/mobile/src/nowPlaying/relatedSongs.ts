import {
  createRelatedSongsSession,
  isUnsearchedTrackId,
  parseTrackId,
  type RelatedSongsShown,
} from "@wave/core";
import * as Result from "effect/Result";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { online } from "@/native/waveNative";
import type { NativeYtRelated, NativeYtSong } from "@/native/waveYtMusic";
import { artistOpeningRequest } from "@/ytmusic/artistOpeningRequest";
import { askYtMusic } from "@/ytmusic/askYtMusic";

/**
 * The session's related songs (Now Playing's Related view), one read per
 * song (Core's `createRelatedSongsSession`). Offline, the read fails before
 * reaching the network.
 */
const relatedSongs = createRelatedSongsSession(async (videoId): Promise<NativeYtRelated> => {
  const result = await askYtMusic((ytMusic) =>
    artistOpeningRequest(online, ytMusic.related(videoId)),
  );
  if (Result.isFailure(result)) throw new Error(`Related songs: ${result.failure.reason}`);
  return result.success;
});

/**
 * What the Related view shows for the song [videoId] (Core's
 * `RelatedSongsShown`), reading it the first time the session shows it, and
 * Try Again, which reads it again after a failure.
 */
export const useRelatedSongs = (
  videoId: string | null | undefined,
): { readonly shown: RelatedSongsShown<NativeYtRelated>; readonly retry: () => void } => {
  const shown = useSyncExternalStore(relatedSongs.subscribe, () => relatedSongs.shown(videoId));
  const retry = useCallback(() => {
    if (typeof videoId === "string") relatedSongs.read(videoId);
  }, [videoId]);
  useEffect(retry, [retry]);
  return { shown, retry };
};

/**
 * The video id of the song [trackId] playing: a streamed song's own, the one
 * a Library song was downloaded from (null when it has none: never matched on
 * YouTube Music), undefined while it isn't known yet (the Library is read, or
 * an unsearched entry is searched).
 */
export const usePlayingVideoId = (
  trackId: string | null,
  ytSong: NativeYtSong | null,
): string | null | undefined => {
  const track = trackId === null ? null : parseTrackId(trackId);
  const libraryId = track?.kind === "library" ? track.id : null;
  const [read, setRead] = useState<{ readonly id: number; readonly videoId: string | null }>();
  useEffect(() => {
    if (libraryId === null) return undefined;
    let current = true;
    appRuntime
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      .runPromise(LibraryStore.use((store) => store.videoIds([libraryId])))
      .then(
        (videoIds) => {
          if (current) setRead({ id: libraryId, videoId: videoIds.get(libraryId) ?? null });
        },
        () => {
          if (current) setRead({ id: libraryId, videoId: null });
        },
      );
    return () => {
      current = false;
    };
  }, [libraryId]);
  if (trackId === null) return null;
  if (track?.kind === "yt") return ytSong?.videoId ?? track.videoId;
  if (libraryId !== null) return read?.id === libraryId ? read.videoId : undefined;
  return isUnsearchedTrackId(trackId) ? undefined : null;
};
