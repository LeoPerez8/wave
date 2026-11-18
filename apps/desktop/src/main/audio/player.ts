/**
 * The Player: plays one local file through the audio process main supervises. Every call
 * answers with the engine's status after it.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { PlaybackStatus, PlaybackEvent } from "../../shared/playback.ts";
import type { AudioCall } from "./protocol.ts";
import {
  AudioEngineError,
  superviseAudio,
  type AudioSupervisor,
  type AudioSupervisorOptions,
} from "./supervisor.ts";

export interface PlayerShape {
  /** Opens `path`, paused at its start, in place of the song before. */
  readonly load: (path: string, key?: string) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  readonly preload: (
    path?: string,
    key?: string,
  ) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  readonly setVolume: (volume: number) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  readonly subscribe: (listener: (event: PlaybackEvent) => void) => () => void;
  readonly play: () => Effect.Effect<PlaybackStatus, AudioEngineError>;
  readonly pause: () => Effect.Effect<PlaybackStatus, AudioEngineError>;
  readonly seek: (positionMs: number) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  readonly status: () => Effect.Effect<PlaybackStatus, AudioEngineError>;
}

export class Player extends Context.Service<Player, PlayerShape>()("@wave/desktop/Player") {}

const asError = (error: unknown) =>
  error instanceof AudioEngineError ? error : new AudioEngineError("engine", String(error));

const playerOf = (audio: AudioSupervisor): PlayerShape => {
  const run = (call: AudioCall, args: readonly unknown[]) =>
    Effect.tryPromise({ try: () => audio.call(call, args), catch: asError });
  return {
    load: (path, key) => run("load", [path, key]),
    preload: (path, key) => run("preload", [path, key]),
    setVolume: (volume) => run("setVolume", [volume]),
    subscribe: audio.subscribe,
    play: () => run("play", []),
    pause: () => run("pause", []),
    seek: (positionMs) => run("seek", [positionMs]),
    status: () => run("status", []),
  };
};

/** The Player over audio processes from `options.fork`, shut down with the layer's scope. */
export const playerLayer = (options: AudioSupervisorOptions) =>
  Layer.effect(
    Player,
    Effect.acquireRelease(
      Effect.sync(() => superviseAudio(options)),
      (audio) => Effect.sync(() => audio.dispose()),
    ).pipe(Effect.map(playerOf)),
  );
