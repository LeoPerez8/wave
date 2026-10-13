/**
 * What the queue knows about its tracks: everything the player needs to play
 * them and the queue rows need to show them. The Queue service learns a
 * track's details with the command that queues it, before the queue changes,
 * so Up Next renders filled rows on its first frame. Kept free of Expo so it
 * runs under plain Node tests.
 */
import {
  libraryTrackIds,
  parseTrackId,
  ytSongArtist,
  ytTrackId,
  type ArtworkPalette,
  type QueueEntry,
  type YtSong,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { makeExternalStore } from "../lib/externalStore.ts";
import type { SongRow } from "../library/LibraryStore.ts";

/** What the player and the queue rows need to know about a track. */
export interface QueueTrack {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly artworkPath: string | null;
  /** Small artwork for the queue rows. */
  readonly thumbPath: string | null;
  /**
   * A YT Music song's artwork palette, for Now Playing's tint (a Library
   * track's comes from the Library).
   */
  readonly palette?: ArtworkPalette | null;
}

/** A library song as the queue needs it. */
export const toQueueTrack = (song: SongRow): QueueTrack => ({
  id: String(song.id),
  path: song.path,
  title: song.title,
  artist: song.artist,
  album: song.album,
  artworkPath: song.artworkPath,
  thumbPath: song.thumbPath,
});

/** A YT Music song's artwork, cached on the phone like a Library track's. */
export interface CachedArtwork {
  readonly path: string;
  readonly thumbPath: string;
  readonly palette: ArtworkPalette;
}

/**
 * A YT Music song as the queue needs it: it goes by its `yt:` track id, which
 * the player streams it by. Without its artwork cached, the player shows
 * YouTube's cover and the queue rows none.
 */
export const toYtQueueTrack = (song: YtSong, artwork: CachedArtwork | null): QueueTrack => {
  const id = ytTrackId(song.videoId);
  return {
    id,
    path: id,
    title: song.title,
    artist: ytSongArtist(song),
    album: song.album,
    artworkPath: artwork?.path ?? song.artworkUrl,
    thumbPath: artwork?.thumbPath ?? null,
    palette: artwork?.palette ?? null,
  };
};

/** The queued tracks by id. Kept for the app's lifetime, so every queue open reads it. */
export const queueTracks = makeExternalStore<ReadonlyMap<string, QueueTrack>>(new Map());

/**
 * Adds [tracks] to what the queue knows; `forgetOthers` (a new play) drops
 * the old queue's tracks first.
 */
export const learnQueueTracks = (
  tracks: readonly QueueTrack[],
  options: { readonly forgetOthers?: boolean } = {},
): void => {
  if (options.forgetOthers === true) {
    requested.clear();
    queueTracks.set(new Map(tracks.map((track) => [track.id, track])));
    return;
  }
  if (tracks.length === 0) return;
  const next = new Map(queueTracks.get());
  for (const track of tracks) next.set(track.id, track);
  queueTracks.set(next);
};

/** How many YT Music covers are cached at once while a play goes on (`cacheYtCoversLater`). */
export const YT_COVERS_AT_ONCE = 2;

/**
 * Caches [songs]' covers after their play has started, a few at a time, each
 * filling in its queued track as it lands (Up Next's thumbnail, Now Playing's
 * tint). A song that has left the queue meanwhile stays out of it; a cover
 * that can't be cached leaves YouTube's. [cacheArtwork] is YT Music's, passed
 * in so this stays free of Expo.
 */
export const cacheYtCoversLater = <E, R>(
  songs: readonly YtSong[],
  cacheArtwork: (url: string) => Effect.Effect<CachedArtwork, E, R>,
): Effect.Effect<void, never, R> =>
  Effect.forEach(
    songs,
    (song) =>
      song.artworkUrl === null
        ? Effect.void
        : cacheArtwork(song.artworkUrl).pipe(
            Effect.tap((artwork) =>
              Effect.sync(() => {
                const track = toYtQueueTrack(song, artwork);
                if (queueTracks.get().has(track.id)) learnQueueTracks([track]);
              }),
            ),
            Effect.ignore,
          ),
    { concurrency: YT_COVERS_AT_ONCE, discard: true },
  );

/** Ids looked up in the library and not failed, so they aren't asked for again. */
const requested = new Set<string>();

/**
 * The track ids in [entries] the queue doesn't know and hasn't asked the
 * library for yet (a queue picked back up from the player after JS restarted
 * comes without its tracks). Marks them asked for: each is looked up once.
 */
export const tracksToLookUp = (entries: readonly QueueEntry[]): readonly string[] => {
  const known = queueTracks.get();
  const ids: string[] = [];
  for (const { trackId } of entries) {
    if (known.has(trackId) || requested.has(trackId)) continue;
    requested.add(trackId);
    ids.push(trackId);
  }
  return ids;
};

/** A lookup that didn't go through: its ids are asked for again next time. */
export const lookupFailed = (ids: readonly string[]): void => {
  for (const id of ids) requested.delete(id);
};

/**
 * Looks up, once, the queued tracks the queue doesn't know (it was picked back
 * up from the player after JS restarted), so Up Next can show them: Library
 * tracks in the library, YT Music songs among the details saved with the
 * queue ([savedYtTracks]). A failed lookup is tried again next time.
 * [songsByIds] is the library's (`LibraryStore.songsByIds`), passed in so this
 * stays free of Expo.
 */
export const learnUnknownQueueTracks = <E, R>(
  entries: readonly QueueEntry[],
  songsByIds: (ids: readonly number[]) => Effect.Effect<readonly SongRow[], E, R>,
  savedYtTracks: () => readonly QueueTrack[] = () => [],
): Effect.Effect<void, never, R> =>
  Effect.suspend(() => {
    const missing = tracksToLookUp(entries);
    if (missing.length === 0) return Effect.void;
    const streamed = new Set(missing.filter((id) => parseTrackId(id)?.kind === "yt"));
    if (streamed.size > 0) {
      learnQueueTracks(savedYtTracks().filter((track) => streamed.has(track.id)));
    }
    const libraryIds = libraryTrackIds(missing);
    if (libraryIds.length === 0) return Effect.void;
    const asked = missing.filter((id) => !streamed.has(id));
    return songsByIds(libraryIds).pipe(
      Effect.map((songs) => learnQueueTracks(songs.map(toQueueTrack))),
      Effect.catch(() => Effect.sync(() => lookupFailed(asked))),
    );
  });
