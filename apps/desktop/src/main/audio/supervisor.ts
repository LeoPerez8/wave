/**
 * Main's hold on the audio process. Each call goes to the process and waits for its answer; a
 * process that exits, or stops answering, is replaced, and the new one gets the song back,
 * paused where it was. So a crash or a stall in audio never reaches the window.
 *
 * The process asks main for a YT Music song's address with a `resolve` event; main answers
 * through `options.resolve`. A load that fetches a song may take as long as the network does.
 */
import type { PlaybackStatus, PlaybackEvent } from "../../shared/playback.ts";
import {
  failure,
  streamedVideoId,
  type AudioCall,
  type AudioRequest,
  type AudioResponse,
  type ResolveAnswer,
  type ResolveEvent,
  type ResolvedStream,
} from "./protocol.ts";

/** What a forked process reports back. */
export interface AudioEvents {
  readonly message: (response: AudioResponse | PlaybackEvent | ResolveEvent) => void;
  readonly exit: () => void;
}

export interface AudioProcess {
  readonly send: (request: AudioRequest | ResolveAnswer) => void;
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
  /** How long a call may wait while a YT Music song is fetched for a load. */
  readonly streamCallTimeoutMs?: number;
  /**
   * A YT Music song's address, from the JVM; `fresh` asks past one it kept. A failure's `code`
   * reaches the load that needed it. The address is the session's: never log it.
   */
  readonly resolve?: (videoId: string, fresh: boolean) => Promise<ResolvedStream>;
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

export const superviseAudio = (options: AudioSupervisorOptions): AudioSupervisor => {
  const callTimeoutMs = options.callTimeoutMs ?? 5_000;
  const streamCallTimeoutMs = options.streamCallTimeoutMs ?? 45_000;
  const restartDelayMs = options.restartDelayMs ?? backoff;
  let current: AudioProcess | undefined;
  let nextId = 1;
  let failuresInARow = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const waiting = new Map<number, Waiting>();
  const listeners = new Set<(event: PlaybackEvent) => void>();
  /** The song to give a new process, and where it was. */
  let song: { path: string; positionMs: number; key?: string | undefined } | undefined;
  /** The song lined up after it, which becomes the song once the engine moves on to it. */
  let lined: { readonly path: string; readonly key: string } | undefined;
  let volume: number | undefined;

  const remember = (call: AudioCall, args: readonly unknown[], status: PlaybackStatus) => {
    if (call === "load") {
      song = { path: String(args[0]), positionMs: status.positionMs, key: status.key };
      lined = undefined;
      return;
    }
    if (call === "preload") {
      const [path, key] = args;
      lined = typeof path === "string" && typeof key === "string" ? { path, key } : undefined;
    }
    if (call === "setVolume") volume = Number(args[0]);
    if (song !== undefined && status.state !== "idle") song.positionMs = status.positionMs;
  };

  /** Follows the engine onto the song it moved to by itself. */
  const follow = (status: PlaybackStatus) => {
    if (song === undefined) return;
    if (lined !== undefined && status.key === lined.key && song.key !== lined.key) {
      song = { path: lined.path, key: lined.key, positionMs: status.positionMs };
      lined = undefined;
    } else if (status.state !== "idle") song.positionMs = status.positionMs;
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
      // Calls queue behind a load that fetches a song, so they wait as long as it may.
      const fetching =
        (call === "load" && streamedVideoId(args[0]) !== undefined) ||
        [...waiting.values()].some(
          (w) => w.call === "load" && streamedVideoId(w.args[0]) !== undefined,
        );
      const timer = setTimeout(
        () => {
          const stalled = waiting.get(id);
          if (stalled === undefined) return;
          waiting.delete(id);
          stalled.reject(new AudioEngineError("stalled", `the audio engine didn't answer ${call}`));
          if (current === target) target.kill();
        },
        fetching ? streamCallTimeoutMs : callTimeoutMs,
      );
      waiting.set(id, { call, args, resolve, reject, restoring, timer });
      target.send({ id, call, args });
    });

  const resolveFor = (owner: AudioProcess, event: ResolveEvent) => {
    const asked =
      options.resolve === undefined
        ? Promise.reject(new Error("YT Music isn't available"))
        : options.resolve(event.videoId, event.fresh);
    void asked.then(
      (address) => owner === current && owner.send({ resolved: event.id, address }),
      (error: unknown) => {
        if (owner !== current) return;
        const coded = error as { code?: unknown; message?: unknown };
        owner.send({
          resolved: event.id,
          error:
            typeof coded.code === "string"
              ? { code: coded.code, message: String(coded.message ?? coded.code) }
              : failure(error),
        });
      },
    );
  };

  const onMessage =
    (owner: AudioProcess) => (response: AudioResponse | PlaybackEvent | ResolveEvent) => {
      if (owner !== current) return;
      if ("event" in response && response.event === "resolve") {
        resolveFor(owner, response);
        return;
      }
      if ("event" in response) {
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
    if (song !== undefined) {
      const { path, positionMs, key } = song;
      const next = lined;
      const level = volume;
      // Paused where it was, at the same volume, the next song lined up again; a failure here
      // shows on the user's next call.
      void send("load", [path, key], true)
        .then(() => (positionMs > 0 ? send("seek", [positionMs], true) : undefined))
        .then(() => (level === undefined ? undefined : send("setVolume", [level], true)))
        .then(() => (next === undefined ? undefined : send("preload", [next.path, next.key], true)))
        .catch(() => undefined);
    } else if (volume !== undefined) void send("setVolume", [volume], true).catch(() => undefined);
    return child;
  }

  const heartbeat = setInterval(() => {
    if (current !== undefined && waiting.size === 0) void send("status", []).catch(() => undefined);
  }, options.heartbeatMs ?? 2_000);
  heartbeat.unref?.();

  start();

  return {
    call: (call, args) => send(call, args),
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
      current?.kill();
      current = undefined;
    },
  };
};
