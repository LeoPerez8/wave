import {
  EMPTY_QUEUE,
  applyPlayerSync,
  parseQueueState,
  planPlayerSync,
  reduceQueue,
  type PlayerList,
  type QueueCommand,
  type QueueEntry,
  type QueueState,
  type RepeatMode,
  type SyncStep,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import { makeExternalStore } from "@/lib/externalStore";
import type { NativeSyncStep, PlayerItem } from "@/native/wavePlayer";

import { Player, PlayerError, playbackState } from "./Player";

/** What the player needs to know about a track to play it. */
export interface QueueTrack {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly artworkPath: string | null;
}

/** The queue as the app shows it (Up Next, shuffle and repeat toggles, the playing row). */
export const queueState = makeExternalStore<QueueState>(EMPTY_QUEUE);

/**
 * Counts the times the queue sent the current entry back to its start
 * (previous after three seconds, or next past the end of the queue), which
 * ends the play going on (see `PlayHistory`).
 */
export const queueRestarts = makeExternalStore(0);

export class Queue extends Context.Service<
  Queue,
  {
    /**
     * Runs a queue command and brings the native player in line. `tracks` must
     * describe every track id the command adds (play, Play Next, Add to Queue).
     */
    readonly dispatch: (
      command: QueueCommand,
      tracks?: readonly QueueTrack[],
    ) => Effect.Effect<void, PlayerError>;
    /**
     * Loads a queue saved before Wave's process ended, paused at [positionMs]
     * in its current entry. Does nothing (and returns false) when a queue is
     * already loaded, e.g. the player kept playing while JS restarted.
     * `tracks` must describe every track id in [state].
     */
    readonly restore: (
      state: QueueState,
      tracks: readonly QueueTrack[],
      positionMs: number,
    ) => Effect.Effect<boolean, PlayerError>;
  }
>()("@wave/mobile/playback/Queue") {}

const toNative = (step: SyncStep): NativeSyncStep => {
  switch (step.type) {
    case "clear":
      return { type: "clear" };
    case "replace":
      return { type: "replace", keys: step.keys, index: step.index };
    case "seek":
      return { type: "seek", key: step.key };
    case "edit":
      return { type: "edit", at: step.at, removeCount: step.removeCount, keys: step.insertKeys };
  }
};

const sameKeys = (entries: readonly QueueEntry[], keys: readonly string[]): boolean =>
  entries.length === keys.length && entries.every((entry, i) => entry.key === keys[i]);

const reportError = (error: unknown): void =>
  playbackState.update((previous) => ({
    ...previous,
    error: error instanceof Error ? error.message : String(error),
  }));

/** Where the current track is now, extrapolated from the last position report. */
export const currentPositionMs = (): number => {
  const state = playbackState.get();
  return state.isPlaying ? state.positionMs + (Date.now() - state.at) : state.positionMs;
};

export const layer = Layer.effect(
  Queue,
  Effect.gen(function* () {
    const player = yield* Player;
    // Every queue change, from the UI or the player, runs one at a time in this lane.
    const lane = yield* Semaphore.make(1);
    const tracks = new Map<string, QueueTrack>();
    // What the native player holds, as far as JS knows. Only the lane edits the
    // list; the player moves `currentKey` on its own (auto-advance, notification).
    let native: PlayerList = { keys: [], currentKey: null };
    let appliedRepeat: RepeatMode | null = null;

    const itemFor = (entry: QueueEntry): Effect.Effect<PlayerItem, PlayerError> => {
      const track = tracks.get(entry.trackId);
      if (track === undefined) {
        return Effect.fail(
          new PlayerError({
            operation: "update the queue",
            cause: `unknown track ${entry.trackId}`,
          }),
        );
      }
      return Effect.succeed({ ...track, id: entry.key });
    };

    const applyPlan = (state: QueueState) =>
      Effect.gen(function* () {
        const steps = planPlayerSync(native, {
          keys: state.entries.map((entry) => entry.key),
          index: state.index,
        });
        if (steps.length === 0) return;
        const loaded = new Set(native.keys);
        const items = yield* Effect.forEach(
          state.entries.filter((entry) => !loaded.has(entry.key)),
          itemFor,
        );
        yield* player.applySync(steps.map(toNative), items);
        native = applyPlayerSync(native, steps);
      });

    /** Syncs the player; if JS's picture of it was off, re-reads it and tries once more. */
    const sync = (state: QueueState) =>
      applyPlan(state).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            native = yield* player.getItemIds;
            yield* applyPlan(state);
          }),
        ),
      );

    const run = (command: QueueCommand, added: readonly QueueTrack[]) =>
      Effect.gen(function* () {
        if (command.type === "play") tracks.clear();
        for (const track of added) tracks.set(track.id, track);
        if (command.type === "playerMoved") native = { ...native, currentKey: command.key };
        const before = queueState.get();
        const { state, playback } = reduceQueue(before, command);
        if (state === before && playback === "keep") return;
        queueState.set(state);
        yield* sync(state);
        if (state.repeat !== appliedRepeat) {
          yield* player.setRepeatMode(state.repeat);
          appliedRepeat = state.repeat;
        }
        switch (playback) {
          case "play":
            yield* player.play;
            break;
          case "restart":
            queueRestarts.update((count) => count + 1);
            yield* player.seekTo(0);
            break;
          case "stop":
            queueRestarts.update((count) => count + 1);
            yield* player.pause;
            yield* player.seekTo(0);
            break;
          case "keep":
            break;
        }
        yield* player.saveQueue(JSON.stringify(state));
      });

    const dispatch = (command: QueueCommand, added: readonly QueueTrack[] = []) =>
      lane.withPermit(run(command, added));

    /**
     * Picks the queue back up when JS restarts while the player kept going
     * (Wave was backgrounded and its activity or JS runtime went away).
     */
    const restore = Effect.gen(function* () {
      native = yield* player.getItemIds;
      const json = yield* player.savedQueue;
      const saved = json === null ? null : parseQueueState(JSON.parse(json));
      if (saved === null || !sameKeys(saved.entries, native.keys)) return;
      queueState.set(saved);
      appliedRepeat = saved.repeat;
      if (native.currentKey !== null) {
        yield* run({ type: "playerMoved", key: native.currentKey }, []);
      }
    }).pipe(Effect.catch(() => Effect.void));

    yield* lane.take(1);
    yield* Effect.forkScoped(restore.pipe(Effect.ensuring(lane.release(1))));

    // Notification, lock screen and Bluetooth skips, and gapless auto-advance.
    yield* player.onItemTransition((event) => {
      if (event.itemId === null) return;
      if (event.reason !== "auto" && event.reason !== "seek") return;
      Effect.runFork(
        dispatch({ type: "playerMoved", key: event.itemId }).pipe(
          Effect.catch((error) => Effect.sync(() => reportError(error))),
        ),
      );
    });

    const restoreSaved = (state: QueueState, added: readonly QueueTrack[], positionMs: number) =>
      lane.withPermit(
        Effect.gen(function* () {
          if (queueState.get().entries.length > 0) return false;
          native = yield* player.getItemIds;
          if (native.keys.length > 0) return false;
          for (const track of added) tracks.set(track.id, track);
          queueState.set(state);
          // A fresh player stays paused: nothing here asks it to play.
          yield* sync(state);
          yield* player.setRepeatMode(state.repeat);
          appliedRepeat = state.repeat;
          if (positionMs > 0) yield* player.seekTo(positionMs);
          yield* player.saveQueue(JSON.stringify(state));
          return true;
        }).pipe(Effect.tapError(() => Effect.sync(() => queueState.set(EMPTY_QUEUE)))),
      );

    return Queue.of({ dispatch, restore: restoreSaved });
  }),
);
