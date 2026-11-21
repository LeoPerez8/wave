/**
 * The Player: plays one local file through the audio process main supervises. Every call
 * answers with the engine's status after it.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AudioMeasurement } from "@wave/client/songMeasurements";
import type { OutputDevice, PlaybackStatus, PlaybackEvent } from "../../shared/playback.ts";
import { YtMusic } from "../yt/ytMusic.ts";
import type { AudioCall } from "./protocol.ts";
import {
  AudioEngineError,
  superviseAudio,
  type AudioSupervisor,
  type AudioSupervisorOptions,
} from "./supervisor.ts";

export interface PlayerShape {
  /**
   * Opens `path`, paused at its start, in place of the song before, to play at `gainDb` while
   * Normalize Volume is on (as it is, without one).
   */
  readonly load: (
    path: string,
    key?: string,
    gainDb?: number,
  ) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  /**
   * Lines up the song after the current one, or none without `path`. `fade` false keeps the move
   * gapless whatever Crossfade is (repeat one).
   */
  readonly preload: (
    path?: string,
    key?: string,
    gainDb?: number,
    fade?: boolean,
  ) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  readonly setVolume: (volume: number) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  /** Crossfade in seconds, 0 for off; applies from the next move. */
  readonly setCrossfade: (seconds: number) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  /** Normalize Volume's switch; applies from the next frame. */
  readonly setNormalize: (on: boolean) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  /**
   * The YT Music songs Settings › Playback › Buffer reaches after the current one, as video
   * ids in playing order: the audio process fetches them into its cache ahead of their turn.
   */
  readonly buffer: (videoIds: readonly string[]) => Effect.Effect<PlaybackStatus, AudioEngineError>;
  /** Measures the loudness of the file at `path`, after those asked before. */
  readonly measure: (path: string) => Promise<AudioMeasurement>;
  /** Stops the measurements running and waiting; each answers `cancelled`. */
  readonly cancelMeasurements: () => Effect.Effect<PlaybackStatus, AudioEngineError>;
  readonly subscribe: (listener: (event: PlaybackEvent) => void) => () => void;
  /** The outputs the system has, as the engine last saw them. */
  readonly outputs: () => readonly OutputDevice[];
  /**
   * Plays on the output with `id` while the system has it, and on the system's default
   * otherwise or without one. The song goes on from where it is.
   */
  readonly setOutput: (id?: string) => Effect.Effect<PlaybackStatus, AudioEngineError>;
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
    load: (path, key, gainDb) => run("load", [path, key, gainDb]),
    preload: (path, key, gainDb, fade) => run("preload", [path, key, gainDb, fade]),
    setVolume: (volume) => run("setVolume", [volume]),
    setCrossfade: (seconds) => run("setCrossfade", [seconds]),
    setNormalize: (on) => run("setNormalize", [on]),
    buffer: (videoIds) => run("buffer", [videoIds]),
    measure: audio.measure,
    cancelMeasurements: () => run("cancelMeasurements", []),
    subscribe: audio.subscribe,
    outputs: audio.outputs,
    setOutput: (id) => run("setOutput", [id]),
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

/**
 * The Player that also plays YT Music songs (`yt:` paths): the audio process asks for their
 * addresses, which YtMusic resolves through the JVM.
 */
export const streamingPlayerLayer = (options: Omit<AudioSupervisorOptions, "resolve">) =>
  Layer.effect(
    Player,
    Effect.gen(function* () {
      const yt = yield* YtMusic;
      const audio = yield* Effect.acquireRelease(
        Effect.sync(() => superviseAudio({ ...options, resolve: yt.resolve })),
        (audio) => Effect.sync(() => audio.dispose()),
      );
      return playerOf(audio);
    }),
  );
