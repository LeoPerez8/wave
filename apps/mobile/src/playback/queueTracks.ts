/**
 * What the queue knows about its tracks: everything the player needs to play
 * them and the queue rows need to show them. The Queue service learns a
 * track's details with the command that queues it, before the queue changes,
 * so Up Next renders filled rows on its first frame. Kept free of Expo so it
 * runs under plain Node tests.
 */
import {
  createQueueCoverBatcher,
  isExplicit,
  isUnsearchedTrackId,
  joinArtists,
  libraryTrackIds,
  withQueueCovers,
  parseTrackId,
  splitCredit,
  streamedCoverUrl,
  streamedCoverUrls,
  trackRowDownloaded,
  UNKNOWN_ARTIST,
  unsearchedTrackId,
  ytSongArtist,
  ytTrackId,
  type ArtworkPalette,
  type QueueCover,
  type QueueEntry,
  type ShuffleSong,
  type UnsearchedSong,
  type YtSong,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { makeExternalStore } from "../lib/externalStore.ts";
import type { PlayableSongRow } from "../library/LibraryStore.ts";
import type { NativeYtSong } from "../native/waveYtMusic.ts";

/** What the player and the queue rows need to know about a track. */
export interface QueueTrack {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  /**
   * A YT Music song's artists as YouTube Music credits them, for Now Playing's
   * artist link (Core's `streamedArtistLink`). Missing from a Library track's,
   * and from a YT Music song's saved before they were kept.
   */
  readonly artists?: readonly string[];
  readonly album: string | null;
  readonly artworkPath: string | null;
  /** Small artwork for the queue rows. */
  readonly thumbPath: string | null;
  /**
   * A YT Music song's artwork palette, for Now Playing's tint (a Library
   * track's comes from the Library).
   */
  readonly palette?: ArtworkPalette | null;
  /**
   * Whether it's explicit (a Library song's flag, a YT Music song's mark):
   * the queue passes it over while Don't play explicit is on. Absent counts
   * as clean (unknown, or saved before it was kept).
   */
  readonly explicit?: boolean;
  /**
   * The YT Music song it was queued from, whole, so Now Playing can download
   * it or add it to a playlist. Missing from a Library track's, and from a YT
   * Music song's saved before it was kept (`queuedYtSong` rebuilds that one).
   */
  readonly ytSong?: QueuedYtSong;
}

/**
 * A YT Music song as the queue keeps it: with its album's browse id when the
 * list it was played from had one (a native list's `NativeYtSong`).
 */
export type QueuedYtSong = YtSong & { readonly albumId?: string | null };

/**
 * Whether a queue row carries the downloaded icon: a Library song whose file
 * is still there, not one a scan has since left a missing song ([missingIds],
 * Track ids as the queue writes them).
 */
export const queueTrackDownloaded = (
  track: QueueTrack | undefined,
  missingIds: ReadonlySet<string>,
): boolean =>
  track !== undefined &&
  trackRowDownloaded({ trackId: track.id, missing: missingIds.has(track.id) });

/** A library song as the queue needs it. */
export const toQueueTrack = (song: PlayableSongRow): QueueTrack => ({
  id: String(song.id),
  path: song.path,
  title: song.title,
  artist: song.artist,
  album: song.album,
  artworkPath: song.artworkPath,
  thumbPath: song.thumbPath,
  explicit: isExplicit(song.explicit),
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
 * YouTube's cover at the large size (Core's `streamedCoverUrl`) and the queue
 * rows none.
 */
export const toYtQueueTrack = (song: QueuedYtSong, artwork: CachedArtwork | null): QueueTrack => {
  const id = ytTrackId(song.videoId);
  return {
    id,
    path: id,
    title: song.title,
    artist: ytSongArtist(song),
    artists: song.artists,
    album: song.album,
    artworkPath:
      artwork?.path ?? (song.artworkUrl === null ? null : streamedCoverUrl(song.artworkUrl)),
    thumbPath: artwork?.thumbPath ?? null,
    palette: artwork?.palette ?? null,
    explicit: song.explicit,
    ytSong: song,
  };
};

/**
 * What Even Shuffle knows of a song from what the queue holds of it, as for
 * a streamed song (a YT Music song or an unsearched entry): its first artist,
 * or the primary artist of the credit shown when its artists weren't kept
 * (Core's `splitCredit`, so "A feat. B" goes by "A"; none when the credit
 * names nobody), and its album; its genre is unknown.
 */
export const queuedShuffleSong = (track: QueueTrack): ShuffleSong => ({
  artist: track.artists?.[0] ?? primaryArtist(track.artist),
  genre: null,
  album: track.album,
});

/**
 * What Even Shuffle orders [trackIds] by, per track id: each song's artist,
 * genre and album as the Library has them ([library], `shuffleSongs`), else
 * from what the queue holds of it ([queued], `queuedShuffleSong`): a streamed
 * song, or a Library song the Library couldn't be asked about. A song neither
 * knows is left out.
 */
export const evenShuffleSongs = (
  trackIds: readonly string[],
  library: ReadonlyMap<string, ShuffleSong>,
  queued: ReadonlyMap<string, QueueTrack>,
): Map<string, ShuffleSong> => {
  const songs = new Map<string, ShuffleSong>();
  for (const trackId of trackIds) {
    const track = queued.get(trackId);
    const song =
      library.get(trackId) ?? (track === undefined ? undefined : queuedShuffleSong(track));
    if (song !== undefined) songs.set(trackId, song);
  }
  return songs;
};

/** The first artist [credit] names, null when it names none. */
const primaryArtist = (credit: string): string | null => {
  const [first] = splitCredit(credit);
  return first === undefined || first === UNKNOWN_ARTIST ? null : first;
};

/**
 * The YT Music song a queue track was queued from, as a native list gives
 * it (its album's browse id null when unknown); null for any other track. A
 * track saved before the queue kept its song is rebuilt from what it shows,
 * without the length or cover YouTube Music gave it.
 */
export const queuedYtSong = (track: QueueTrack): NativeYtSong | null => {
  const ref = parseTrackId(track.id);
  if (ref?.kind !== "yt") return null;
  if (track.ytSong !== undefined) return { ...track.ytSong, albumId: track.ytSong.albumId ?? null };
  return {
    videoId: ref.videoId,
    title: track.title,
    artists: track.artists ?? [track.artist],
    album: track.album,
    durationMs: null,
    artworkUrl: null,
    explicit: track.explicit ?? false,
    albumId: null,
  };
};

/**
 * An unsearched song as the queue needs it: it goes by its unsearched id
 * (`unsearchedTrackId`) and shows what Spotify listed. The player never
 * holds it (it's searched before it plays), and like a YT Music song whose
 * cover isn't cached, the queue rows show no cover for it.
 */
export const toUnsearchedQueueTrack = (song: UnsearchedSong): QueueTrack => {
  const id = unsearchedTrackId(song);
  return {
    id,
    path: id,
    title: song.title,
    artist: joinArtists(song.artists),
    artists: song.artists,
    album: song.album,
    artworkPath: song.artworkUrl,
    thumbPath: null,
    palette: null,
  };
};

/**
 * Caches a streamed song's cover from YouTube's [url] at the size playback
 * shows it (Core's `streamedCoverUrls`): the first address that caches, so a
 * video without its largest thumbnail gets the next. Fails as the last one
 * does. Lists keep the small cover; only playback and the cache take this one.
 */
export const cacheStreamedCover = <E, R>(
  url: string,
  cacheArtwork: (url: string) => Effect.Effect<CachedArtwork, E, R>,
): Effect.Effect<CachedArtwork, E, R> => {
  const [first, ...rest] = streamedCoverUrls(url);
  if (first === undefined) return cacheArtwork(url);
  return rest.reduce<Effect.Effect<CachedArtwork, E, R>>(
    (cached, next) => Effect.catch(cached, () => cacheArtwork(next)),
    cacheArtwork(first),
  );
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
 * Caches [songs]' covers after their play has started, a few at a time,
 * filling in their queued tracks (Up Next's thumbnails, Now Playing's tint).
 * Covers landing close together fill in together, in one change of the
 * queue's tracks (Core's `createQueueCoverBatcher`); the [playing] song's
 * fills in at once. A song that has left the queue isn't cached, and one that
 * leaves while its cover is cached stays out of it; a cover that can't be
 * cached leaves YouTube's. Each batch, once in the queue's tracks, goes on to
 * [toPlayer] (by track id, only songs still queued), so the player's items
 * show the cached file too. [cacheArtwork] is YT Music's, passed in so this
 * stays free of Expo.
 */
export const cacheYtCoversLater = <E, R>(
  songs: readonly YtSong[],
  cacheArtwork: (url: string) => Effect.Effect<CachedArtwork, E, R>,
  playing: (trackId: string) => boolean = () => false,
  toPlayer: (covers: ReadonlyMap<string, QueueCover>) => void = () => {},
): Effect.Effect<void, never, R> =>
  Effect.suspend(() => {
    const batcher = createQueueCoverBatcher({
      schedule: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
      playing,
      apply: (covers) => {
        const tracks = queueTracks.get();
        queueTracks.set(withQueueCovers(tracks, covers));
        const queued = new Map([...covers].filter(([id]) => tracks.has(id)));
        if (queued.size > 0) toPlayer(queued);
      },
    });
    return Effect.forEach(
      songs,
      (song) => {
        const id = ytTrackId(song.videoId);
        if (song.artworkUrl === null || !queueTracks.get().has(id)) return Effect.void;
        return cacheStreamedCover(song.artworkUrl, cacheArtwork).pipe(
          Effect.tap(({ path, thumbPath, palette }) =>
            Effect.sync(() => batcher.add(id, { artworkPath: path, thumbPath, palette })),
          ),
          Effect.ignore,
        );
      },
      { concurrency: YT_COVERS_AT_ONCE, discard: true },
    ).pipe(Effect.ensuring(Effect.sync(batcher.flush)));
  });

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
 * Reads the tracks the player is about to load that the queue doesn't know,
 * waiting for them, whatever `tracksToLookUp` asked for already: a queue picked
 * back up from the player comes without its tracks, and its window moves onto
 * them. Library tracks come from the library ([songsByIds]), YT Music songs from
 * the details saved with the queue ([savedYtTracks]). One that can't be read
 * stays unknown. Reads nothing when every track is known.
 */
export const learnTracksToLoad = <E, R>(
  trackIds: readonly string[],
  songsByIds: (ids: readonly number[]) => Effect.Effect<readonly PlayableSongRow[], E, R>,
  savedYtTracks: () => readonly QueueTrack[],
): Effect.Effect<void, never, R> =>
  Effect.suspend(() => {
    const known = queueTracks.get();
    const missing = trackIds.filter((id) => !known.has(id));
    if (missing.length === 0) return Effect.void;
    const wanted = new Set(missing);
    if (missing.some((id) => parseTrackId(id)?.kind === "yt")) {
      learnQueueTracks(savedYtTracks().filter((track) => wanted.has(track.id)));
    }
    const libraryIds = libraryTrackIds(missing);
    if (libraryIds.length === 0) return Effect.void;
    return songsByIds(libraryIds).pipe(
      Effect.map((songs) => learnQueueTracks(songs.map(toQueueTrack))),
      Effect.catch(() => Effect.void),
    );
  });

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
  songsByIds: (ids: readonly number[]) => Effect.Effect<readonly PlayableSongRow[], E, R>,
  savedYtTracks: () => readonly QueueTrack[] = () => [],
): Effect.Effect<void, never, R> =>
  Effect.suspend(() => {
    const missing = tracksToLookUp(entries);
    if (missing.length === 0) return Effect.void;
    const streamed = new Set(
      missing.filter((id) => parseTrackId(id)?.kind === "yt" || isUnsearchedTrackId(id)),
    );
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
