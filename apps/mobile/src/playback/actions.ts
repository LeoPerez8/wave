import {
  startSleepTimer,
  type QueueCommand,
  type QueueContext,
  type RepeatMode,
  type SleepTimerChoice,
} from "@wave/core";
import * as Effect from "effect/Effect";

import type { SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";

import { Player, playbackState } from "./Player";
import { Queue, currentPositionMs, queueState, type QueueTrack } from "./Queue";

const toTrack = (song: SongRow): QueueTrack => ({
  id: String(song.id),
  path: song.path,
  title: song.title,
  artist: song.artist,
  album: song.album,
  artworkPath: song.artworkPath,
});

const run = (effect: Effect.Effect<void, unknown, Player | Queue>): void => {
  void appRuntime.runPromise(effect).catch((error: unknown) =>
    playbackState.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : String(error),
    })),
  );
};

const dispatch = (command: QueueCommand, songs: readonly SongRow[] = []): void =>
  run(
    Effect.gen(function* () {
      const queue = yield* Queue;
      yield* queue.dispatch(command, songs.map(toTrack));
    }),
  );

/** Starts the player's event sync and picks up a queue that is already playing. */
export const connectPlayer = (): void => run(Effect.asVoid(Queue));

/**
 * Plays a list (an album, the Songs list…) from `startIndex`, queueing the rest
 * of it. Omit `startIndex` to start at the top, or anywhere with `shuffle`.
 */
export const playSongs = (
  songs: readonly SongRow[],
  startIndex: number | undefined,
  context: QueueContext,
  options: { readonly shuffle?: boolean } = {},
): void =>
  dispatch(
    {
      type: "play",
      trackIds: songs.map((song) => String(song.id)),
      startIndex,
      context,
      shuffle: options.shuffle,
    },
    songs,
  );

export const togglePlayPause = (): void =>
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* playbackState.get().playWhenReady ? player.pause : player.play;
    }),
  );

export const skipToNext = (): void => dispatch({ type: "next" });

/** Restarts the track after 3 seconds, otherwise goes to the previous one. */
export const skipToPrevious = (): void =>
  dispatch({ type: "previous", positionMs: currentPositionMs() });

export const playNext = (songs: readonly SongRow[]): void =>
  dispatch({ type: "playNext", trackIds: songs.map((song) => String(song.id)) }, songs);

export const addToQueue = (songs: readonly SongRow[]): void =>
  dispatch({ type: "addToQueue", trackIds: songs.map((song) => String(song.id)) }, songs);

export const setShuffle = (on: boolean): void => dispatch({ type: "setShuffle", on });

export const toggleShuffle = (): void => setShuffle(!queueState.get().shuffle);

export const setRepeat = (mode: RepeatMode): void => dispatch({ type: "setRepeat", mode });

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };

/** Off → all → one → off, like Apple Music's repeat button. */
export const cycleRepeat = (): void => setRepeat(NEXT_REPEAT[queueState.get().repeat]);

/** Plays an Up Next entry. */
export const playQueueEntry = (key: string): void => dispatch({ type: "jumpTo", key });

export const moveQueueEntry = (key: string, toUpNextIndex: number): void =>
  dispatch({ type: "move", key, toUpNextIndex });

export const removeQueueEntry = (key: string): void => dispatch({ type: "remove", key });

/**
 * Seeks the current track. The position shows at once, before the player
 * confirms it, so the scrubber doesn't jump back and "previous" sees it.
 */
export const seekTo = (positionMs: number): void => {
  playbackState.update((state) => ({ ...state, positionMs, at: Date.now() }));
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.seekTo(positionMs);
    }),
  );
};

/**
 * Starts the sleep timer, replacing a running one. The playback service
 * enforces it, and `sleepTimerState` follows it from there.
 */
export const setSleepTimer = (choice: SleepTimerChoice): void => {
  const timer = startSleepTimer(choice, Date.now());
  if (timer === null) return;
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.setSleepTimer(timer);
    }),
  );
};

export const cancelSleepTimer = (): void =>
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.setSleepTimer(null);
    }),
  );
