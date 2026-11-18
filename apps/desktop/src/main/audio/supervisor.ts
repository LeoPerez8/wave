/**
 * Main's hold on the audio process. Each call goes to the process and waits for its answer; a
 * process that exits, or stops answering, is replaced, and the new one gets the song back,
 * paused where it was, with the playback settings. So a crash or a stall in audio never reaches
 * the window.
 */
import type { AudioMeasurement } from "@wave/client/songMeasurements";
import type { LoudnessResult, PlaybackStatus, PlaybackEvent } from "../../shared/playback.ts";
import type { AudioCall, AudioRequest, AudioResponse } from "./protocol.ts";

/** What a forked process reports back. */
export interface AudioEvents {
  readonly message: (response: AudioResponse | PlaybackEvent) => void;
  readonly exit: () => void;
}

export interface AudioProcess {
  readonly send: (request: AudioRequest) => void;
  readonly kill: () => void;
}

export interface AudioSupervisorOptions {
  /** Starts an audio process that reports to `events`. */
  readonly fork: (events: AudioEvents) => AudioProcess;
  /** How long a call may wait for its answer before the process counts as stalled. */
  readonly callTimeoutMs?: number;
  /** How often an idle process is asked for its status, to find a stall nobody is waiting on. */
  readonly heartbeatMs?: number;
  /** The wait before the `attempt`th restart in a row (from 1). */
  readonly restartDelayMs?: (attempt: number) => number;
}

/** A call the engine refused, or one the process couldn't answer. */
export class AudioEngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AudioEngineError";
    this.code = code;
  }
}

export interface AudioSupervisor {
  readonly call: (call: AudioCall, args: readonly unknown[]) => Promise<PlaybackStatus>;
  /**
   * Measures the loudness of the file at [path] (Normalize Volume), one file at a time behind
   * those asked before; rejects when the process goes before it answers.
   */
  readonly measure: (path: string) => Promise<AudioMeasurement>;
  readonly dispose: () => void;
  readonly subscribe: (listener: (event: PlaybackEvent) => void) => () => void;
}

interface Waiting {
  readonly call: AudioCall;
  readonly args: readonly unknown[];
  readonly resolve: (status: PlaybackStatus) => void;
  readonly reject: (error: AudioEngineError) => void;
  /** Sent by main to give a new process the song back, not by the window. */
  readonly restoring: boolean;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Restarts in a row, with no call answered between them, after which the song isn't restored. */
const RESTORE_ATTEMPTS = 3;

const backoff = (attempt: number) => Math.min(250 * 2 ** (attempt - 1), 10_000);

const measurementOf = (result: LoudnessResult): AudioMeasurement =>
  result.kind === "measured"
    ? { kind: "measured", loudness: result.loudness ?? Number.NaN, peak: result.peak ?? 0 }
    : { kind: result.kind };

const gainOf = (value: unknown) => (typeof value === "number" ? value : undefined);

export const superviseAudio = (options: AudioSupervisorOptions): AudioSupervisor => {
  const callTimeoutMs = options.callTimeoutMs ?? 5_000;
  const restartDelayMs = options.restartDelayMs ?? backoff;
  let current: AudioProcess | undefined;
  let nextId = 1;
  let failuresInARow = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const waiting = new Map<number, Waiting>();
  const listeners = new Set<(event: PlaybackEvent) => void>();
  /** The song to give a new process, where it was, and the gain it plays at. */
  let song:
    | { path: string; positionMs: number; key?: string | undefined; gainDb?: number | undefined }
    | undefined;
  /** The song lined up after it, which becomes the song once the engine moves on to it. */
  let lined:
    | {
        readonly path: string;
        readonly key: string;
        readonly gainDb: number | undefined;
        readonly fade: boolean | undefined;
      }
    | undefined;
  let volume: number | undefined;
  let crossfade: number | undefined;
  let normalize: boolean | undefined;
  /** Measurements asked of the process running, by id. */
  const measuring = new Map<
    string,
    {
      readonly resolve: (result: AudioMeasurement) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  let nextMeasurement = 1;

  const remember = (call: AudioCall, args: readonly unknown[], status: PlaybackStatus) => {
    if (call === "load") {
      song = {
        path: String(args[0]),
        positionMs: status.positionMs,
        key: status.key,
        gainDb: gainOf(args[2]),
      };
      lined = undefined;
      return;
    }
    if (call === "preload") {
      const [path, key, gainDb, fade] = args;
      lined =
        typeof path === "string" && typeof key === "string"
          ? {
              path,
              key,
              gainDb: gainOf(gainDb),
              fade: typeof fade === "boolean" ? fade : undefined,
            }
          : undefined;
    }
    if (call === "setVolume") volume = Number(args[0]);
    if (call === "setCrossfade") crossfade = Number(args[0]);
    if (call === "setNormalize") normalize = args[0] === true;
    if (song !== undefined && status.state !== "idle") song.positionMs = status.positionMs;
  };

  /** Follows the engine onto the song it moved to by itself. */
  const follow = (status: PlaybackStatus) => {
    if (song === undefined) return;
    if (lined !== undefined && status.key === lined.key && song.key !== lined.key) {
      const { path, key, gainDb } = lined;
      song = { path, key, positionMs: status.positionMs, gainDb };
      lined = undefined;
    } else if (status.state !== "idle") song.positionMs = status.positionMs;
  };

  const dropMeasurements = (code: string, message: string) => {
    for (const [id, pending] of measuring) {
      measuring.delete(id);
      pending.reject(new AudioEngineError(code, message));
    }
  };

  const failAll = (code: string, message: string) => {
    for (const [id, call] of waiting) {
      clearTimeout(call.timer);
      waiting.delete(id);
      call.reject(new AudioEngineError(code, message));
    }
  };

  const send = (
    call: AudioCall,
    args: readonly unknown[],
    restoring = false,
  ): Promise<PlaybackStatus> =>
    new Promise((resolve, reject) => {
      if (disposed) {
        reject(new AudioEngineError("disposed", "the audio engine was shut down"));
        return;
      }
      const target = current ?? start();
      const id = nextId++;
      const timer = setTimeout(() => {
        const stalled = waiting.get(id);
        if (stalled === undefined) return;
        waiting.delete(id);
        stalled.reject(new AudioEngineError("stalled", `the audio engine didn't answer ${call}`));
        if (current === target) target.kill();
      }, callTimeoutMs);
      waiting.set(id, { call, args, resolve, reject, restoring, timer });
      target.send({ id, call, args });
    });

  const onMessage = (owner: AudioProcess) => (response: AudioResponse | PlaybackEvent) => {
    if (owner !== current) return;
    if ("event" in response) {
      for (const result of response.measurements ?? []) {
        const pending = measuring.get(result.id);
        measuring.delete(result.id);
        pending?.resolve(measurementOf(result));
      }
      follow(response.status);
      for (const listener of listeners) listener(response);
      return;
    }
    const call = waiting.get(response.id);
    if (call === undefined) return;
    clearTimeout(call.timer);
    waiting.delete(response.id);
    if (response.ok) {
      if (!call.restoring) {
        failuresInARow = 0;
        remember(call.call, call.args, response.result);
      }
      call.resolve(response.result);
    } else call.reject(new AudioEngineError(response.error.code, response.error.message));
  };

  const onExit = (owner: AudioProcess) => () => {
    if (owner !== current) return;
    current = undefined;
    failAll("restarted", "the audio engine restarted");
    dropMeasurements("restarted", "the audio engine restarted");
    if (disposed) return;
    failuresInARow += 1;
    // A song that crashes the process wherever it's restored would crash it for ever.
    if (failuresInARow >= RESTORE_ATTEMPTS) song = undefined;
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (!disposed && current === undefined) start();
    }, restartDelayMs(failuresInARow));
  };

  function start(): AudioProcess {
    let child: AudioProcess | undefined;
    const events: AudioEvents = {
      message: (response) => child !== undefined && onMessage(child)(response),
      exit: () => child !== undefined && onExit(child)(),
    };
    child = options.fork(events);
    current = child;
    const settings: [AudioCall, unknown[]][] = [];
    if (volume !== undefined) settings.push(["setVolume", [volume]]);
    if (crossfade !== undefined) settings.push(["setCrossfade", [crossfade]]);
    if (normalize !== undefined) settings.push(["setNormalize", [normalize]]);
    const restoreSettings = () =>
      settings.reduce<Promise<unknown>>(
        (before, [call, args]) => before.then(() => send(call, args, true)),
        Promise.resolve(),
      );
    if (song !== undefined) {
      const { path, positionMs, key, gainDb } = song;
      const next = lined;
      // Paused where it was, with the same settings, the next song lined up again; a failure
      // here shows on the user's next call.
      void send("load", gainDb === undefined ? [path, key] : [path, key, gainDb], true)
        .then(() => (positionMs > 0 ? send("seek", [positionMs], true) : undefined))
        .then(restoreSettings)
        .then(() =>
          next === undefined
            ? undefined
            : send("preload", [next.path, next.key, next.gainDb, next.fade], true),
        )
        .catch(() => undefined);
    } else void restoreSettings().catch(() => undefined);
    return child;
  }

  const heartbeat = setInterval(() => {
    if (current !== undefined && waiting.size === 0) void send("status", []).catch(() => undefined);
  }, options.heartbeatMs ?? 2_000);
  heartbeat.unref?.();

  start();

  return {
    call: (call, args) => send(call, args),
    measure: (path) =>
      new Promise((resolve, reject) => {
        const id = `m${nextMeasurement++}`;
        measuring.set(id, { resolve, reject });
        send("measure", [path, id]).catch((error: unknown) => {
          if (!measuring.delete(id)) return;
          reject(error instanceof Error ? error : new AudioEngineError("engine", String(error)));
        });
      }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(heartbeat);
      listeners.clear();
      if (restartTimer !== undefined) clearTimeout(restartTimer);
      failAll("disposed", "the audio engine was shut down");
      dropMeasurements("disposed", "the audio engine was shut down");
      current?.kill();
      current = undefined;
    },
  };
};
