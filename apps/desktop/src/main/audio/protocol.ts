/**
 * The messages between main and the audio process. Main sends one request per call; the
 * process answers each with the engine's status after it, or with the engine's error.
 */
import type { PlaybackStatus, PlaybackEvent } from "../../shared/playback.ts";

/** The addon's `AudioEngine`, as `apps/desktop/native/node` exports it. */
export interface AddonEngine {
  readonly load: (path: string, key?: string) => PlaybackStatus;
  readonly preload: (path: string | undefined, key: string | undefined) => void;
  readonly setVolume: (volume: number) => void;
  readonly transitions: () => PlaybackEvent["transitions"];
  readonly play: () => void;
  readonly pause: () => void;
  readonly seek: (positionMs: number) => void;
  readonly status: () => PlaybackStatus;
}

export type AudioCall = "load" | "play" | "pause" | "seek" | "status" | "preload" | "setVolume";

export interface AudioRequest {
  readonly id: number;
  readonly call: AudioCall;
  readonly args: readonly unknown[];
}

export interface AudioFailure {
  /** The engine's code (`not-found`, `unsupported`, `decode`, `nothing-loaded`) or the process's. */
  readonly code: string;
  readonly message: string;
}

export type AudioResponse =
  | { readonly id: number; readonly ok: true; readonly result: PlaybackStatus }
  | { readonly id: number; readonly ok: false; readonly error: AudioFailure };

const failure = (error: unknown): AudioFailure => {
  const text = error instanceof Error ? error.message : String(error);
  const coded = /^\[([a-z-]+)\] (.*)$/s.exec(text);
  return coded === null
    ? { code: "engine", message: text }
    : { code: coded[1] ?? "engine", message: coded[2] ?? text };
};

const run = (engine: AddonEngine, request: AudioRequest): PlaybackStatus | undefined => {
  switch (request.call) {
    case "load":
      return engine.load(String(request.args[0]), request.args[1] as string | undefined);
    case "preload":
      engine.preload(request.args[0] as string | undefined, request.args[1] as string | undefined);
      return engine.status();
    case "setVolume":
      engine.setVolume(Number(request.args[0]));
      return engine.status();
    case "play":
      engine.play();
      return engine.status();
    case "pause":
      engine.pause();
      return engine.status();
    case "seek":
      engine.seek(Number(request.args[0]));
      return engine.status();
    case "status":
      return engine.status();
    default:
      return undefined;
  }
};

/** Runs `request` on `engine`; `undefined` means the addon failed to load. Never throws. */
export const answer = (
  engine: AddonEngine | undefined,
  request: AudioRequest,
  unavailable = "the audio engine didn't load",
): AudioResponse => {
  if (engine === undefined)
    return { id: request.id, ok: false, error: { code: "unavailable", message: unavailable } };
  try {
    const result = run(engine, request);
    return result === undefined
      ? { id: request.id, ok: false, error: { code: "unknown-call", message: request.call } }
      : { id: request.id, ok: true, result };
  } catch (error) {
    return { id: request.id, ok: false, error: failure(error) };
  }
};

/** [response] with the time the process took its status, so main can tell an older one. */
export const stamped = (response: AudioResponse, atMs: number): AudioResponse =>
  response.ok ? { ...response, result: { ...response.result, observedAtMs: atMs } } : response;

const sameStatus = (a: PlaybackStatus, b: PlaybackStatus) =>
  a.state === b.state &&
  a.positionMs === b.positionMs &&
  a.durationMs === b.durationMs &&
  a.key === b.key &&
  a.device === b.device;

/**
 * What the process pushes to main at [atMs]: the engine's status and the songs it moved on to
 * since [previous], or nothing when neither changed.
 */
export const playbackEvent = (
  engine: AddonEngine,
  previous: PlaybackStatus | undefined,
  atMs: number,
): PlaybackEvent | undefined => {
  const status = engine.status();
  const transitions = engine.transitions();
  if (previous !== undefined && transitions.length === 0 && sameStatus(previous, status)) {
    return undefined;
  }
  return { event: "playback", status: { ...status, observedAtMs: atMs }, transitions };
};
