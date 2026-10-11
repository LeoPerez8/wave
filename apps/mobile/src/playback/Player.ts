import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeExternalStore } from "@/lib/externalStore";
import { WavePlayer, type NativePlayerState, type PlayerItem } from "@/native/wavePlayer";

export class PlayerError extends Data.TaggedError("PlayerError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Couldn't ${this.operation}: ${String(this.cause)}`;
  }
}

export interface PlaybackState extends Omit<NativePlayerState, "index"> {
  /** The last playback error for the current item, cleared when the item changes. */
  readonly error: string | null;
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
};

/** What the player is doing, for the mini player and track rows. */
export const playbackState = makeExternalStore<PlaybackState>(IDLE);

/** The native player as a typed service. JS owns the order; the player plays the list it's given. */
export class Player extends Context.Service<
  Player,
  {
    readonly setItems: (
      items: readonly PlayerItem[],
      startIndex: number,
      options?: { readonly positionMs?: number; readonly play?: boolean },
    ) => Effect.Effect<void, PlayerError>;
    readonly play: Effect.Effect<void, PlayerError>;
    readonly pause: Effect.Effect<void, PlayerError>;
    readonly seekTo: (positionMs: number) => Effect.Effect<void, PlayerError>;
  }
>()("@wave/mobile/playback/Player") {}

const call = (operation: string, run: () => Promise<unknown>): Effect.Effect<void, PlayerError> =>
  Effect.tryPromise({ try: run, catch: (cause) => new PlayerError({ operation, cause }) }).pipe(
    Effect.asVoid,
  );

const fromNative = ({ index: _index, ...state }: NativePlayerState): Omit<PlaybackState, "error"> =>
  state;

/** Mirrors native player events into [playbackState] for as long as the layer lives. */
const syncState = Effect.acquireRelease(
  Effect.sync(() => {
    const subscriptions = [
      WavePlayer.addListener("onPlaybackState", (state) =>
        playbackState.update((previous) => ({
          ...fromNative(state),
          error: previous.item?.id === state.item?.id ? previous.error : null,
        })),
      ),
      WavePlayer.addListener("onPosition", (position) =>
        playbackState.update((previous) => ({ ...previous, ...position })),
      ),
      WavePlayer.addListener("onPlayerError", (event) =>
        playbackState.update((previous) => ({ ...previous, error: event.message })),
      ),
    ];
    // The service may already be playing (Wave was reopened from the notification).
    WavePlayer.getState()
      .then((state) => playbackState.update((previous) => ({ ...previous, ...fromNative(state) })))
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
      setItems: (items, startIndex, options) =>
        call("start playback", () =>
          WavePlayer.setItems(items, startIndex, options?.positionMs ?? 0, options?.play ?? true),
        ),
      play: call("resume playback", () => WavePlayer.play()),
      pause: call("pause playback", () => WavePlayer.pause()),
      seekTo: (positionMs) => call("seek", () => WavePlayer.seekTo(positionMs)),
    });
  }),
);
