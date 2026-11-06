import {
  createRelatedSearches,
  createRelatedSongsSession,
  isUnsearchedTrackId,
  parseTrackId,
  relatedLibraryVideoId,
  type RelatedLibraryRead,
  type RelatedSongsShown,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { online } from "@/native/waveNative";
import type { NativeYtRelated, NativeYtSong } from "@/native/waveYtMusic";
import { artistOpeningRequest } from "@/ytmusic/artistOpeningRequest";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { withSearchTurn } from "@/ytmusic/searchAllowance";

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
 * Try Again, which reads it again after a failure, or for a song with no
 * video id runs [findAgain] (`usePlayingVideoId`).
 */
export const useRelatedSongs = (
  videoId: string | null | undefined,
  findAgain: () => void,
): { readonly shown: RelatedSongsShown<NativeYtRelated>; readonly retry: () => void } => {
  const shown = useSyncExternalStore(relatedSongs.subscribe, () => relatedSongs.shown(videoId));
  const read = useCallback(() => {
    if (typeof videoId === "string") relatedSongs.read(videoId);
  }, [videoId]);
  useEffect(read, [read]);
  // A Library song whose search found no video id searches again; one with an id reads again.
  const retry = videoId === null ? findAgain : read;
  return { shown, retry };
};

/**
 * The session's searches for a playing Library song without a video id
 * (Core's `createRelatedSearches`, as Magic Queue searches a seed): one
 * Songs search of its title and artists in the search allowance. Offline,
 * it fails before reaching the network.
 */
const relatedSearches = createRelatedSearches(async (query) => {
  const result = await askYtMusic((ytMusic) =>
    artistOpeningRequest(
      online,
      withSearchTurn("related", query, ytMusic.searchSongs(query)).pipe(
        Effect.map((page) => page.songs),
      ),
    ),
  );
  if (Result.isFailure(result)) throw new Error(`Related search: ${result.failure.reason}`);
  return result.success;
});

/** What the Library gave for the Library song [id] playing (Core's `RelatedLibraryRead`). */
type LibraryRead = { readonly id: number; readonly read: RelatedLibraryRead };

/** The Library's video id for song [id], else the song to search for, else that it lacks the song. */
const readLibrarySong = (id: number) =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) =>
    Effect.gen(function* () {
      const stored = (yield* store.videoIds([id])).get(id);
      if (stored !== undefined) return { status: "videoId", videoId: stored } as const;
      const [song] = yield* store.songsByIds([id]);
      if (song === undefined) return { status: "unread" } as const;
      const artists = yield* store.artistsByIds(song.artistIds);
      const names = new Map(artists.map((artist) => [artist.id, artist.name]));
      return {
        status: "search",
        song: {
          id,
          title: song.title,
          artists: song.artistIds.flatMap((artist) => names.get(artist) ?? []),
          durationMs: song.durationMs,
        },
      } as const;
    }),
  );

const NO_SEARCH = (): void => {};

/**
 * The video id of the song [trackId] playing: a streamed song's own, the one
 * a Library song was downloaded from, or for a Library song without one, what
 * a search of its title and artists found (`createRelatedSearches`; null when
 * nothing matched or the search failed, or the Library couldn't give the
 * song), undefined while it isn't known yet (the Library is read, the song
 * searched, or an unsearched entry searched). [findAgain] is Try Again for a
 * Library song with none: it searches again, or reads the Library again
 * (Core's `relatedLibraryVideoId`).
 */
export const usePlayingVideoId = (
  trackId: string | null,
  ytSong: NativeYtSong | null,
): { readonly videoId: string | null | undefined; readonly findAgain: () => void } => {
  const track = trackId === null ? null : parseTrackId(trackId);
  const libraryId = track?.kind === "library" ? track.id : null;
  const [library, setLibrary] = useState<LibraryRead>();
  // Try Again's count of reads of a Library that couldn't give the song.
  const [readAgain, setReadAgain] = useState(0);
  useEffect(() => {
    if (libraryId === null) return undefined;
    let current = true;
    appRuntime.runPromise(readLibrarySong(libraryId)).then(
      (read) => {
        if (current) setLibrary({ id: libraryId, read });
      },
      () => {
        if (current) setLibrary({ id: libraryId, read: { status: "unread" } });
      },
    );
    return () => {
      current = false;
    };
  }, [libraryId, readAgain]);
  const read = library !== undefined && library.id === libraryId ? library.read : undefined;
  const search = read?.status === "search" ? read.song : null;
  useEffect(() => {
    if (search !== null) relatedSearches.find(search);
  }, [search]);
  const found = useSyncExternalStore(relatedSearches.subscribe, () =>
    search === null ? undefined : relatedSearches.videoId(search.id),
  );
  const { videoId, tryAgain } = relatedLibraryVideoId(read, found);
  const findAgain = useCallback(() => {
    if (tryAgain === "search" && search !== null) relatedSearches.findAgain(search);
    if (tryAgain === "readLibrary") {
      setLibrary(undefined);
      setReadAgain((count) => count + 1);
    }
  }, [tryAgain, search]);
  if (trackId === null) return { videoId: null, findAgain: NO_SEARCH };
  if (track?.kind === "yt")
    return { videoId: ytSong?.videoId ?? track.videoId, findAgain: NO_SEARCH };
  if (libraryId !== null) return { videoId, findAgain };
  return { videoId: isUnsearchedTrackId(trackId) ? undefined : null, findAgain: NO_SEARCH };
};
