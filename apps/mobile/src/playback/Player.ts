import { playerErrorNotice, type PlaybackSignal, type PlaySource, type RepeatMode, type SleepTimer } from "@wave/core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import { makeExternalStore } from "@/lib/externalStore";
import {
  WavePlayer,
  type ItemTransitionEvent,
  type NativeItemIds,
  type NativePlayerState,
  type NativeSyncStep,
  type PlayerItem,
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

export interface PlaybackState extends Omit<NativePlayerState, "index"> {
  /**
   * The last playback error for the current item, cleared when the item
   * changes or plays again.
   */
  readonly error: string | null;
  /**
   * What the player says about that error in place of the artist (Core's
   * `playerErrorNotice`): a file that couldn't play, or why a YT Music song
   * couldn't stream. Null with no error from the player.
   */
  readonly notice: string | null;
}

const IDLE: PlaybackState = {
  status: "idle",
  isPlaying: false,
  playWhenReady: false,
  item: null,
  positionMs: 0,
  durationMs: null,
  at: 0,
  error: null,
  notice: null,
};

/**
 * What the player is doing, for the mini player and track rows. `item.id` is
 * the queue entry key; the track id comes from the queue (`useCurrentTrackId`).
 */
export const playbackState = makeExternalStore<PlaybackState>(IDLE);

/** The sleep timer the playback service is running, if any (it enforces it natively). */
export const sleepTimerState = makeExternalStore<SleepTimer | null>(null);

/**
 * The native player as a typed service. JS owns the order (Core's queue
 * engine); the player holds the list it's synced to and plays it gaplessly.
 */
export class Player extends Context.Service<
  Player,
  {
    /** Edits the native item list; `items` carries metadata for the keys new to the player. */
    readonly applySync: (
      steps: readonly NativeSyncStep[],
      items: readonly PlayerItem[],
    ) => Effect.Effect<void, PlayerError>;
    readonly setRepeatMode: (mode: RepeatMode) => Effect.Effect<void, PlayerError>;
    /** Shows the queue's shuffle and repeat on Android Auto's player screen. */
    readonly setModes: (shuffle: boolean, repeat: RepeatMode) => Effect.Effect<void, PlayerError>;
    readonly getItemIds: Effect.Effect<NativeItemIds, PlayerError>;
    readonly saveQueue: (json: string, source: PlaySource) => Effect.Effect<void>;
    readonly savedQueue: Effect.Effect<string | null>;
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
    readonly onCrossfade: (
      listener: (event: Extract<PlaybackSignal, { type: "crossfade" }>) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly play: Effect.Effect<void, PlayerError>;
    readonly pause: Effect.Effect<void, PlayerError>;
    readonly seekTo: (positionMs: number) => Effect.Effect<void, PlayerError>;
    /** Starts (or, with null, cancels) the sleep timer in the playback service. */
    readonly setSleepTimer: (timer: SleepTimer | null) => Effect.Effect<void, PlayerError>;
  }
>()("@wave/mobile/playback/Player") {}

const call = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, PlayerError> =>
  Effect.tryPromise({ try: run, catch: (cause) => new PlayerError({ operation, cause }) });

const fromNative = ({
  index: _index,
  ...state
}: NativePlayerState): Omit<PlaybackState, "error" | "notice"> => state;

/** Whether the error on record still stands once the player reports [state]. */
const errorStands = (previous: PlaybackState, state: NativePlayerState): boolean =>
  previous.item?.id === state.item?.id && !state.isPlaying;

/** Mirrors native player events into [playbackState] for as long as the layer lives. */
const syncState = Effect.acquireRelease(
  Effect.sync(() => {
    const subscriptions = [
      WavePlayer.addListener("onPlaybackState", (state) =>
        playbackState.update((previous) => ({
          ...fromNative(state),
          error: errorStands(previous, state) ? previous.error : null,
          notice: errorStands(previous, state) ? previous.notice : null,
        })),
      ),
      WavePlayer.addListener("onPosition", (position) =>
        playbackState.update((previous) => ({ ...previous, ...position })),
      ),
      WavePlayer.addListener("onPlayerError", (event) =>
        playbackState.update((previous) => ({
          ...previous,
          error: event.message,
          notice: playerErrorNotice(event.code),
        })),
      ),
      WavePlayer.addListener("onSleepTimer", (event) => sleepTimerState.set(event.timer)),
    ];
    // The service may already be playing (Wave was reopened from the notification).
    WavePlayer.getState()
      .then((state) => playbackState.update((previous) => ({ ...previous, ...fromNative(state) })))
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
      applySync: (steps, items) =>
        call("update the queue", () => WavePlayer.applySync(steps, items)),
      setRepeatMode: (mode) => call("set repeat", () => WavePlayer.setRepeatMode(mode)),
      setModes: (shuffle, repeat) =>
        call("show shuffle and repeat", () => WavePlayer.setModes(shuffle, repeat)),
      getItemIds: call("read the queue", () => WavePlayer.getItemIds()),
      saveQueue: (json, source) => Effect.sync(() => WavePlayer.saveQueue(json, source)),
      savedQueue: Effect.sync(() => WavePlayer.savedQueue()),
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
      onCrossfade: (listener) =>
        Effect.asVoid(
          Effect.acquireRelease(
            Effect.sync(() => WavePlayer.addListener("onCrossfade", listener)),
            (subscription) => Effect.sync(() => subscription.remove()),
          ),
        ),
      play: call("resume playback", () => WavePlayer.play()),
      pause: call("pause playback", () => WavePlayer.pause()),
      seekTo: (positionMs) => call("seek", () => WavePlayer.seekTo(positionMs)),
      setSleepTimer: (timer) =>
        timer === null
          ? call("cancel the sleep timer", () => WavePlayer.cancelSleepTimer())
          : call("set the sleep timer", () =>
              WavePlayer.setSleepTimer(timer.type, timer.type === "deadline" ? timer.endsAt : null),
            ),
    });
  }),
);
