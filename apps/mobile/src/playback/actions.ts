import {
  nextRepeatMode,
  type UpNextMove,
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
import { Queue, currentPositionMs, queueState, toQueueTrack } from "./Queue";

/**
 * Runs [effect] and reports a failure. The promise settles once it has run
 * either way and never rejects, so callers that don't wait can drop it.
 */
const run = (effect: Effect.Effect<void, unknown, Player | Queue>): Promise<void> =>
  appRuntime.runPromise(effect).catch((error: unknown) =>
    playbackState.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : String(error),
    })),
  );

/** Applies [command] to the queue (see `run`), adding [songs] to the tracks it knows. */
const dispatch = (command: QueueCommand, songs: readonly SongRow[] = []): Promise<void> =>
  run(
    Effect.gen(function* () {
      const queue = yield* Queue;
      yield* queue.dispatch(command, songs.map(toQueueTrack));
    }),
  );

/** Starts the player's event sync and picks up a queue that is already playing. */
export const connectPlayer = (): Promise<void> => run(Effect.asVoid(Queue));

/**
 * Plays a list (an album, the Songs list…) from `startIndex`, queueing the rest
 * of it. Omit `startIndex` to start at the top, or anywhere with `shuffle`.
 */
export const playSongs = (
  songs: readonly SongRow[],
  startIndex: number | undefined,
  context: QueueContext,
  options: { readonly shuffle?: boolean } = {},
): Promise<void> =>
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

export const togglePlayPause = (): Promise<void> =>
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* playbackState.get().playWhenReady ? player.pause : player.play;
    }),
  );

export const skipToNext = (): Promise<void> => dispatch({ type: "next" });

/** Restarts the track after 3 seconds, otherwise goes to the previous one. */
export const skipToPrevious = (): Promise<void> =>
  dispatch({ type: "previous", positionMs: currentPositionMs() });

export const playNext = (songs: readonly SongRow[]): Promise<void> =>
  dispatch({ type: "playNext", trackIds: songs.map((song) => String(song.id)) }, songs);

export const addToQueue = (songs: readonly SongRow[]): Promise<void> =>
  dispatch({ type: "addToQueue", trackIds: songs.map((song) => String(song.id)) }, songs);

export const setShuffle = (on: boolean): Promise<void> => dispatch({ type: "setShuffle", on });

export const toggleShuffle = (): Promise<void> => setShuffle(!queueState.get().shuffle);

export const setRepeat = (mode: RepeatMode): Promise<void> => dispatch({ type: "setRepeat", mode });

/** Off → all → one → off, like Apple Music's repeat button. */
export const cycleRepeat = (): Promise<void> => setRepeat(nextRepeatMode(queueState.get().repeat));

/** Plays an Up Next entry. */
export const playQueueEntry = (key: string): Promise<void> => dispatch({ type: "jumpTo", key });

/**
 * Moves an Up Next entry (Core's `upNextMove`). The promise settles once the
 * queue has the move (or it failed), which may wait on earlier commands and
 * the native player.
 */
export const moveQueueEntry = (move: UpNextMove): Promise<void> =>
  dispatch({ type: "move", ...move });

export const removeQueueEntry = (key: string): Promise<void> => dispatch({ type: "remove", key });

/**
 * Seeks the current track. The position shows at once, before the player
 * confirms it, so the scrubber doesn't jump back and "previous" sees it.
 */
export const seekTo = (positionMs: number): void => {
  playbackState.update((state) => ({ ...state, positionMs, at: Date.now() }));
  void run(
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
  void run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.setSleepTimer(timer);
    }),
  );
};

export const cancelSleepTimer = (): Promise<void> =>
  run(
    Effect.gen(function* () {
      const player = yield* Player;
      yield* player.setSleepTimer(null);
    }),
  );
