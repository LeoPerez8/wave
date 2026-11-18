/**
 * Main's hold on the audio process. Each call goes to the process and waits for its answer; a
 * process that exits, or stops answering, is replaced, and the new one gets the song back,
 * paused where it was. So a crash or a stall in audio never reaches the window.
 */
import type { PlaybackStatus } from "../../shared/playback.ts";
import type { AudioCall, AudioRequest, AudioResponse } from "./protocol.ts";

/** What a forked process reports back. */
export interface AudioEvents {
  readonly message: (response: AudioResponse) => void;
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
  readonly dispose: () => void;
}

interface Waiting {
  readonly call: AudioCall;
  readonly args: readonly unknown[];
  readonly resolve: (status: PlaybackStatus) => void;
  readonly reject: (error: AudioEngineError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const backoff = (attempt: number) => Math.min(250 * 2 ** (attempt - 1), 10_000);

export const superviseAudio = (options: AudioSupervisorOptions): AudioSupervisor => {
  const callTimeoutMs = options.callTimeoutMs ?? 5_000;
  const restartDelayMs = options.restartDelayMs ?? backoff;
  let current: AudioProcess | undefined;
  let nextId = 1;
  let failuresInARow = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const waiting = new Map<number, Waiting>();
  /** The song to give a new process, and where it was. */
  let song: { readonly path: string; positionMs: number } | undefined;

  const remember = (call: AudioCall, args: readonly unknown[], status: PlaybackStatus) => {
    if (call === "load") song = { path: String(args[0]), positionMs: status.positionMs };
    else if (song !== undefined && status.state !== "idle") song.positionMs = status.positionMs;
  };

  const failAll = (code: string, message: string) => {
    for (const [id, call] of waiting) {
      clearTimeout(call.timer);
      waiting.delete(id);
      call.reject(new AudioEngineError(code, message));
    }
  };

  const send = (call: AudioCall, args: readonly unknown[]): Promise<PlaybackStatus> =>
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
      waiting.set(id, { call, args, resolve, reject, timer });
      target.send({ id, call, args });
    });

  const onMessage = (owner: AudioProcess) => (response: AudioResponse) => {
    if (owner !== current) return;
    const call = waiting.get(response.id);
    if (call === undefined) return;
    clearTimeout(call.timer);
    waiting.delete(response.id);
    if (response.ok) {
      failuresInARow = 0;
      remember(call.call, call.args, response.result);
      call.resolve(response.result);
    } else call.reject(new AudioEngineError(response.error.code, response.error.message));
  };

  const onExit = (owner: AudioProcess) => () => {
    if (owner !== current) return;
    current = undefined;
    failAll("restarted", "the audio engine restarted");
    if (disposed) return;
    failuresInARow += 1;
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
    if (song !== undefined) {
      const { path, positionMs } = song;
      // Paused where it was; a failure here shows on the user's next call.
      void send("load", [path])
        .then(() => (positionMs > 0 ? send("seek", [positionMs]) : undefined))
        .catch(() => undefined);
    }
    return child;
  }

  const heartbeat = setInterval(() => {
    if (current !== undefined && waiting.size === 0) void send("status", []).catch(() => undefined);
  }, options.heartbeatMs ?? 2_000);
  heartbeat.unref?.();

  start();

  return {
    call: send,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(heartbeat);
      if (restartTimer !== undefined) clearTimeout(restartTimer);
      failAll("disposed", "the audio engine was shut down");
      current?.kill();
      current = undefined;
    },
  };
};
