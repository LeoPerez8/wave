import { currentEntry, playerCoverUpdates, type QueueCover, type YtSong } from "@wave/core";
import * as Effect from "effect/Effect";

import { YtMusic } from "@/ytmusic/YtMusic";

import { Player } from "./Player";
import { queueState } from "./Queue";
import {
  cacheStreamedCover,
  cacheYtCoversLater,
  toYtQueueTrack,
  type QueueTrack,
} from "./queueTracks";

/** How long a play waits for the song's cover to be cached before it goes on without. */
const ARTWORK_WAIT_MS = 1500;

/**
 * [song] as the queue needs it, with its cover cached on the phone at the
 * size playback shows it (`cacheStreamedCover`), so the notification, Auto
 * and Now Playing's tint work as for a Library track. Offline, or when the
 * cover is slow, it goes on with YouTube's address.
 */
export const ytQueueTrack = (song: YtSong): Effect.Effect<QueueTrack, never, YtMusic> =>
  Effect.gen(function* () {
    if (song.artworkUrl === null) return toYtQueueTrack(song, null);
    const ytMusic = yield* YtMusic;
    const artwork = yield* cacheStreamedCover(song.artworkUrl, ytMusic.cacheArtwork).pipe(
      Effect.timeout(ARTWORK_WAIT_MS),
      Effect.orElseSucceed(() => null),
    );
    return toYtQueueTrack(song, artwork);
  });

/**
 * Caches [songs]' covers in the background, a few at a time, once their play
 * has started (`cacheYtCoversLater`); returns at once. Each cover cached goes
 * to the player's items for its song too, so Now Playing, the notification
 * and Android Auto show the file instead of YouTube's address.
 */
export const cacheYtCoversInBackground = (
  songs: readonly YtSong[],
): Effect.Effect<void, never, YtMusic | Player> =>
  Effect.gen(function* () {
    if (songs.every((song) => song.artworkUrl === null)) return;
    const ytMusic = yield* YtMusic;
    const player = yield* Player;
    const toPlayer = (covers: ReadonlyMap<string, QueueCover>): void => {
      const updates = playerCoverUpdates(queueState.get().entries, covers);
      Effect.runFork(player.setItemArtwork(updates).pipe(Effect.ignore));
    };
    yield* Effect.forkDetach(cacheYtCoversLater(songs, ytMusic.cacheArtwork, isPlaying, toPlayer));
  });

/** Whether [trackId] is the queue's current entry's: its cover tints Now Playing straight away. */
const isPlaying = (trackId: string): boolean => currentEntry(queueState.get())?.trackId === trackId;
