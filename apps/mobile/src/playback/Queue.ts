import {
  EMPTY_QUEUE,
  applyPlayerSync,
  extrapolatePosition,
  keptPlayingEntry,
  parseQueueState,
  planPlayerSync,
  queueSourceAfter,
  reduceQueue,
  type PlayerList,
  type PlaySource,
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
import { learnQueueTracks, queueTracks, type QueueTrack } from "./queueTracks";

export { toQueueTrack, type QueueTrack } from "./queueTracks";

/** The queue as the app shows it (Up Next, shuffle and repeat toggles, the playing row). */
export const queueState = makeExternalStore<QueueState>(EMPTY_QUEUE);

/**
 * The entry the player was on when JS restarted while it kept going, and the
 * queue was picked back up from it; null otherwise. `PlayHistory` goes on with
 * the play on record for it instead of starting a new one.
 */
export const keptPlayingKey = makeExternalStore<string | null>(null);

/**
 * Where the queue's playback was started from: `auto` once Android Auto
 * started it (`Queue.handOver`), `phone` once the app did. Every play in the
 * queue is recorded with it (`PlayHistory`), whoever skips or pauses later.
 */
export const queueSource = makeExternalStore<PlaySource>("phone");

/** Queue changes come in bursts (skips, reorders); the queue is serialised once they settle. */
const QUEUE_SETTLE_MS = 500;

/**
 * The queue as JSON, serialised once per settled change and shared: the player
 * keeps it for when JS restarts, and `PlaybackPersistence` writes it to the library.
 */
export const settledQueue = makeExternalStore<string | null>(null);

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
    /**
     * Starts playback whose items the media session sets on the player itself
     * (a play request from Android Auto): instead of syncing the player,
     * returns every entry of the new queue as a player item and the one to
     * start at. `tracks` must describe every track id the command plays.
     */
    readonly handOver: (
      command: PlayCommand,
      tracks: readonly QueueTrack[],
    ) => Effect.Effect<QueueHandOver, PlayerError>;
    /** Serialises a queue change still settling right away (Wave is leaving the foreground). */
    readonly flush: Effect.Effect<void>;
  }
>()("@wave/mobile/playback/Queue") {}

/** Starting playback of a list: the only command a session request hands over. */
export type PlayCommand = Extract<QueueCommand, { readonly type: "play" }>;

/** The player list a session request gets (see `Queue.handOver`). */
export interface QueueHandOver {
  readonly items: readonly PlayerItem[];
  readonly startIndex: number;
}

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

/** The player item for [entry], from the tracks the queue learned. */
const itemFor = (entry: QueueEntry): Effect.Effect<PlayerItem, PlayerError> => {
  const track = queueTracks.get().get(entry.trackId);
  if (track === undefined) {
    return Effect.fail(
      new PlayerError({
        operation: "update the queue",
        cause: `unknown track ${entry.trackId}`,
      }),
    );
  }
  const { path, title, artist, album, artworkPath } = track;
  return Effect.succeed({ id: entry.key, path, title, artist, album, artworkPath });
};

/**
 * Learns the tracks a command adds, before the queue changes, so Up Next
 * shows them on its first frame; a new play forgets the old queue's.
 */
const learnTracks = (command: QueueCommand, added: readonly QueueTrack[]): void =>
  learnQueueTracks(added, { forgetOthers: command.type === "play" });

const reportError = (error: unknown): void =>
  playbackState.update((previous) => ({
    ...previous,
    error: error instanceof Error ? error.message : String(error),
  }));

/** Where the current track is now, extrapolated from the last position report. */
export const currentPositionMs = (): number => extrapolatePosition(playbackState.get(), Date.now());

export const layer = Layer.effect(
  Queue,
  Effect.gen(function* () {
    const player = yield* Player;
    // Every queue change, from the UI or the player, runs one at a time in this lane.
    const lane = yield* Semaphore.make(1);
    // What the native player holds, as far as JS knows. Only the lane edits the
    // list; the player moves `currentKey` on its own (auto-advance, notification).
    let native: PlayerList = { keys: [], currentKey: null };
    // False once the media session was handed a list to set (`handOver`): JS
    // can't tell whether it did (Auto may have given up waiting, or couldn't
    // read the answer), so the next sync reads what the player holds first.
    let nativeKnown = true;
    let appliedRepeat: RepeatMode | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    /** Serialises the queue once, for the player and the library (`settledQueue`). */
    const settle = (): void => {
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      const json = JSON.stringify(queueState.get());
      Effect.runSync(player.saveQueue(json, queueSource.get()));
      settledQueue.set(json);
    };

    const queueChanged = (): void => {
      settleTimer ??= setTimeout(settle, QUEUE_SETTLE_MS);
    };

    const flush = Effect.sync(() => {
      if (settleTimer !== null) settle();
    });

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

    const readNative = Effect.gen(function* () {
      native = yield* player.getItemIds;
      nativeKnown = true;
    });

    /** Syncs the player; if JS's picture of it was off, re-reads it and tries once more. */
    const sync = (state: QueueState) =>
      (nativeKnown ? applyPlan(state) : Effect.andThen(readNative, applyPlan(state))).pipe(
        Effect.catch(() =>
          Effect.gen(function* () {
            yield* readNative;
            yield* applyPlan(state);
          }),
        ),
      );

    const applyRepeat = (state: QueueState) =>
      Effect.gen(function* () {
        if (state.repeat === appliedRepeat) return;
        yield* player.setRepeatMode(state.repeat);
        appliedRepeat = state.repeat;
      });

    const run = (command: QueueCommand, added: readonly QueueTrack[]) =>
      Effect.gen(function* () {
        learnTracks(command, added);
        if (command.type === "playerMoved") native = { ...native, currentKey: command.key };
        const before = queueState.get();
        const { state, playback } = reduceQueue(before, command);
        if (state === before && playback === "keep") return;
        queueState.set(state);
        if (state !== before) queueChanged();
        yield* sync(state);
        yield* applyRepeat(state);
        switch (playback) {
          case "play":
            yield* player.play;
            break;
          // The player reports the seek back to the start, which ends the play (`PlayHistory`).
          case "restart":
            yield* player.seekTo(0);
            break;
          case "stop":
            yield* player.pause;
            yield* player.seekTo(0);
            break;
          case "keep":
            break;
        }
      });

    const dispatch = (command: QueueCommand, added: readonly QueueTrack[] = []) =>
      lane.withPermit(
        Effect.gen(function* () {
          queueSource.update((source) => queueSourceAfter(source, command, "phone"));
          yield* run(command, added);
        }),
      );

    const handOver = (command: PlayCommand, added: readonly QueueTrack[]) =>
      lane.withPermit(
        Effect.gen(function* () {
          learnTracks(command, added);
          const { state } = reduceQueue(queueState.get(), command);
          const items = yield* Effect.forEach(state.entries, itemFor);
          queueSource.update((source) => queueSourceAfter(source, command, "auto"));
          queueState.set(state);
          queueChanged();
          // What the player holds once the session has set the items; the next
          // sync checks it did (`nativeKnown`) before planning from it.
          native = {
            keys: state.entries.map((entry) => entry.key),
            currentKey: state.entries[state.index]?.key ?? null,
          };
          nativeKnown = false;
          yield* applyRepeat(state);
          return { items, startIndex: Math.max(0, state.index) };
        }),
      );

    /**
     * Picks the queue back up when JS restarts while the player kept going
     * (Wave was backgrounded and its activity or JS runtime went away).
     */
    const restore = Effect.gen(function* () {
      yield* readNative;
      const json = yield* player.savedQueue;
      const saved = json === null ? null : parseQueueState(JSON.parse(json));
      if (saved === null || !sameKeys(saved.entries, native.keys)) return;
      const resumedByPlayer = yield* player.takeResumed;
      keptPlayingKey.set(keptPlayingEntry(native.currentKey, { resumedByPlayer }));
      const source = yield* player.savedQueueSource;
      if (source !== null) queueSource.set(source);
      queueState.set(saved);
      appliedRepeat = saved.repeat;
      if (native.currentKey !== null) {
        yield* run({ type: "playerMoved", key: native.currentKey }, []);
      }
    }).pipe(Effect.catch(() => Effect.void));

    // Auto's shuffle and repeat toggles follow the queue, whether the app or the car changed it.
    let shownModes: string | null = null;
    const showModes = (): void => {
      const { shuffle, repeat } = queueState.get();
      const modes = `${shuffle}/${repeat}`;
      if (modes === shownModes) return;
      shownModes = modes;
      Effect.runFork(
        player.setModes(shuffle, repeat).pipe(
          Effect.catch(() =>
            Effect.sync(() => {
              shownModes = null;
            }),
          ),
        ),
      );
    };
    showModes();
    yield* Effect.acquireRelease(
      Effect.sync(() => queueState.subscribe(showModes)),
      (stop) => Effect.sync(stop),
    );

    yield* lane.take(1);
    yield* Effect.forkScoped(restore.pipe(Effect.ensuring(lane.release(1))));

    // Notification, lock screen and Bluetooth skips, and gapless auto-advance.
    yield* player.onItemTransition((event) => {
      if (event.itemId === null) return;
      // The player was handed a list JS didn't sync: it resumed the saved queue
      // (playback resumption) while JS was up with nothing loaded. Adopt it.
      if (
        event.reason === "playlist" &&
        queueState.get().entries.length === 0 &&
        !native.keys.includes(event.itemId)
      ) {
        Effect.runFork(lane.withPermit(restore));
        return;
      }
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
          yield* readNative;
          if (native.keys.length > 0) return false;
          learnQueueTracks(added);
          queueState.set(state);
          // A fresh player stays paused: nothing here asks it to play.
          yield* sync(state);
          yield* player.setRepeatMode(state.repeat);
          appliedRepeat = state.repeat;
          if (positionMs > 0) yield* player.seekTo(positionMs);
          settle();
          return true;
        }).pipe(Effect.tapError(() => Effect.sync(() => queueState.set(EMPTY_QUEUE)))),
      );

    yield* Effect.addFinalizer(() => flush);

    return Queue.of({ dispatch, handOver, restore: restoreSaved, flush });
  }),
);
