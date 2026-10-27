import {
  type PlayerCoverUpdate,
  type PlaySource,
  type QueueWrite,
  type RepeatMode,
  type SavedQueueParts,
  type SeekSource,
  type SleepTimer,
  type SongChangeCause,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import { makeExternalStore } from "@/lib/externalStore";
import { perfCount } from "@/perf/perf";
import { makePlaybackStores } from "./playbackStores";
import {
  WavePlayer,
  type CrossfadeEndedEvent,
  type ItemTransitionEvent,
  type NativeItemIds,
  type NativeSyncStep,
  type PlayerItem,
  type PlayerErrorEvent,
  type SeekEvent,
} from "@/native/wavePlayer";

export class PlayerError extends Data.TaggedError("PlayerError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Couldn't ${this.operation}: ${String(this.cause)}`;
  }
}

export type { PlaybackState } from "./playbackStores";

/** Position subscriptions acquire native reports; plain snapshot reads never do. */
const stores = makePlaybackStores((requested) => {
  perfCount(requested ? "player.positionDemand.start" : "player.positionDemand.stop");
  WavePlayer.setPositionReporting(requested).catch(() => undefined);
});
export const { playbackState, positionState } = stores;

/** The sleep timer the playback service is running, if any (it enforces it natively). */
export const sleepTimerState = makeExternalStore<SleepTimer | null>(null);

/**
 * The native player as a typed service. JS owns the order (Core's queue
 * engine); the player holds the list it's synced to and plays it gaplessly.
 */
export class Player extends Context.Service<
  Player,
  {
    /**
     * Edits the native item list; `items` carries metadata for the keys new to
     * the player. `cause` is the command the sync follows, which names a song
     * change it makes in the app log's crossfade lines.
     */
    readonly applySync: (
      steps: readonly NativeSyncStep[],
      items: readonly PlayerItem[],
      cause: SongChangeCause,
    ) => Effect.Effect<void, PlayerError>;
    readonly setRepeatMode: (mode: RepeatMode) => Effect.Effect<void, PlayerError>;
    /** Shows the queue's shuffle and repeat on Android Auto's player screen. */
    readonly setModes: (shuffle: boolean, repeat: RepeatMode) => Effect.Effect<void, PlayerError>;
    readonly getItemIds: Effect.Effect<NativeItemIds, PlayerError>;
    /** Gives loaded items their cached cover (Core's `playerCoverUpdates`); playback goes on. */
    readonly setItemArtwork: (
      updates: readonly PlayerCoverUpdate[],
    ) => Effect.Effect<void, PlayerError>;
    /** Keeps the queue parts [write] changed for a JS restart and a cold start; skips its position. */
    readonly saveQueue: (write: QueueWrite, source: PlaySource) => Effect.Effect<void, PlayerError>;
    readonly savedQueue: Effect.Effect<SavedQueueParts | null, PlayerError>;
    readonly savedQueueSource: Effect.Effect<PlaySource | null>;
    /** Whether the player resumed the saved queue on its own (a cold start); clears it. */
    readonly takeResumed: Effect.Effect<boolean>;
    /** Calls `listener` for every item transition while the scope lives. */
    readonly onItemTransition: (
      listener: (event: ItemTransitionEvent) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    /** Calls `listener` for every seek within the current item while the scope lives. */
    readonly onSeek: (
      listener: (event: SeekEvent) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    /** A playback failure, including a video YouTube no longer serves. */
    readonly onPlayerError: (
      listener: (event: PlayerErrorEvent) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    /** Calls `listener` each time a crossfade's outgoing song goes silent, while the scope lives. */
    readonly onCrossfade: (
      listener: (event: CrossfadeEndedEvent) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly play: Effect.Effect<void, PlayerError>;
    readonly pause: Effect.Effect<void, PlayerError>;
    /** Pauses while the song to play is searched (Core's playing walk); the app log says so. */
    readonly pauseForSearch: Effect.Effect<void, PlayerError>;
    /** Seeks the current item; `source` names the seek in the app log's crossfade lines. */
    readonly seekTo: (positionMs: number, source: SeekSource) => Effect.Effect<void, PlayerError>;
    /** Starts (or, with null, cancels) the sleep timer in the playback service. */
    readonly setSleepTimer: (timer: SleepTimer | null) => Effect.Effect<void, PlayerError>;
  }
>()("@wave/mobile/playback/Player") {}

const call = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, PlayerError> =>
  Effect.tryPromise({ try: run, catch: (cause) => new PlayerError({ operation, cause }) });

/** Mirrors native player events into [playbackState] for as long as the layer lives. */
const syncState = Effect.acquireRelease(
  Effect.sync(() => {
    let reported = false;
    const subscriptions = [
      WavePlayer.addListener("onPlaybackState", (state) => {
        perfCount("player.playbackState");
        reported = true;
        stores.reportState(state);
      }),
      WavePlayer.addListener("onPosition", (position) => {
        perfCount("player.positionReport");
        stores.reportPosition(position);
      }),
      WavePlayer.addListener("onPlayerError", stores.reportError),
      WavePlayer.addListener("onSleepTimer", (event) => sleepTimerState.set(event.timer)),
    ];
    // The service may already be playing (Wave was reopened from the notification).
    WavePlayer.getState()
      .then((state) => {
        if (!reported) stores.reportState(state);
      })
      .catch(() => undefined);
    WavePlayer.getSleepTimer()
      .then((timer) => sleepTimerState.set(timer))
      .catch(() => undefined);
    return subscriptions;
  }),
  (subscriptions) =>
    Effect.sync(() => {
      for (const subscription of subscriptions) subscription.remove();
    }),
);

export const layer = Layer.effect(
  Player,
  Effect.gen(function* () {
    yield* syncState;
    return Player.of({
      applySync: (steps, items, cause) =>
        call("update the queue", () => WavePlayer.applySync(steps, items, cause)),
      setRepeatMode: (mode) => call("set repeat", () => WavePlayer.setRepeatMode(mode)),
      setModes: (shuffle, repeat) =>
        call("show shuffle and repeat", () => WavePlayer.setModes(shuffle, repeat)),
      getItemIds: call("read the queue", () => WavePlayer.getItemIds()),
      setItemArtwork: (updates) =>
        updates.length === 0
          ? Effect.void
          : call("show the cached covers", () => WavePlayer.setItemArtwork(updates)),
      saveQueue: (write, source) =>
        call("save the queue", () =>
          WavePlayer.saveQueue(
            write.queue ?? null,
            write.metadata ?? null,
            write.index ?? null,
            source,
          ),
        ),
      savedQueue: call("read the saved queue", () => WavePlayer.savedQueue()),
      savedQueueSource: Effect.sync(() => WavePlayer.savedQueueSource()),
      takeResumed: Effect.sync(() => WavePlayer.takeResumed()),
      onItemTransition: (listener) =>
        Effect.asVoid(
          Effect.acquireRelease(
            Effect.sync(() => WavePlayer.addListener("onItemTransition", listener)),
            (subscription) => Effect.sync(() => subscription.remove()),
          ),
        ),
      onSeek: (listener) =>
        Effect.asVoid(
          Effect.acquireRelease(
            Effect.sync(() => WavePlayer.addListener("onSeek", listener)),
            (subscription) => Effect.sync(() => subscription.remove()),
          ),
        ),
      onPlayerError: (listener) =>
        Effect.asVoid(
          Effect.acquireRelease(
            Effect.sync(() => WavePlayer.addListener("onPlayerError", listener)),
            (subscription) => Effect.sync(() => subscription.remove()),
          ),
        ),
      onCrossfade: (listener) =>
        Effect.asVoid(
          Effect.acquireRelease(
            Effect.sync(() => WavePlayer.addListener("onCrossfade", listener)),
            (subscription) => Effect.sync(() => subscription.remove()),
          ),
        ),
      play: call("resume playback", () => WavePlayer.play()),
      pause: call("pause playback", () => WavePlayer.pause(false)),
      pauseForSearch: call("pause playback", () => WavePlayer.pause(true)),
      seekTo: (positionMs, source) => call("seek", () => WavePlayer.seekTo(positionMs, source)),
      setSleepTimer: (timer) =>
        timer === null
          ? call("cancel the sleep timer", () => WavePlayer.cancelSleepTimer())
          : call("set the sleep timer", () =>
              WavePlayer.setSleepTimer(timer.type, timer.type === "deadline" ? timer.endsAt : null),
            ),
    });
  }),
);
