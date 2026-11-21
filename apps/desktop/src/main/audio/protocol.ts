/**
 * The messages between main and the audio process. Main sends one request per call; the
 * process answers each with the engine's status after it, or with the engine's error.
 */
import type {
  LoudnessResult,
  OutputDevice,
  PlaybackStatus,
  PlaybackEvent,
} from "../../shared/playback.ts";

/** The addon's `AudioEngine`, as `apps/desktop/native/node` exports it. */
export interface AddonEngine {
  /** Opens [path] in place of the song before, to play at [gainDb] while Normalize Volume is on. */
  readonly load: (path: string, key?: string, gainDb?: number) => PlaybackStatus;
  /** Lines up the song after the current one; [fade] false keeps the move gapless (repeat one). */
  readonly preload: (
    path: string | undefined,
    key: string | undefined,
    gainDb?: number,
    fade?: boolean,
  ) => void;
  readonly setVolume: (volume: number) => void;
  /** Crossfade's length in seconds, 0 for off; read as each move is decided. */
  readonly setCrossfade: (seconds: number) => void;
  /** Normalize Volume: off plays every song as it is, from the next frame. */
  readonly setNormalize: (on: boolean) => void;
  /** Measures [path]'s loudness on a thread of its own; the result comes back as [id]. */
  readonly measure: (path: string, id: string) => void;
  /** Stops the measurement running and those waiting; each answers "cancelled". */
  readonly cancelMeasurements: () => void;
  readonly measurements: () => readonly LoudnessResult[];
  readonly transitions: () => PlaybackEvent["transitions"];
  readonly play: () => void;
  readonly pause: () => void;
  readonly seek: (positionMs: number) => void;
  readonly status: () => PlaybackStatus;
  /** The outputs the system has; absent on an engine built before one could be picked. */
  readonly outputs?: () => readonly OutputDevice[];
  /** Plays on the output with [id] while the system has it, else on the system's default. */
  readonly setOutput?: (id?: string) => void;
}

/** A YT Music song's address, as the JVM's `resolveStream` gives it. Never logged. */
export interface ResolvedStream {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly itag: number;
  readonly mimeType: string;
  readonly contentLength?: number | null | undefined;
}

/** How far the engine has a YT Music song: whole in the cache, playable, on its way, or not. */
export type StreamState = "cached" | "ready" | "loading" | "failed" | "missing";

/** The addon's engine with an audio cache, which also plays `yt:<videoId>` paths. */
export interface StreamingEngine extends AddonEngine {
  readonly openStream: (videoId: string, address: ResolvedStream) => void;
  readonly streamState: (videoId: string) => StreamState;
  /** Songs whose address expired while they were fetched. */
  readonly streamRequests: () => readonly { readonly id: number; readonly videoId: string }[];
  readonly answerStream: (id: number, address?: ResolvedStream, error?: string) => void;
}

/** A path the engine reads as a YT Music song. */
export const STREAMED = "yt:";

/** The video id of a `yt:` path, or `undefined` for a file. */
export const streamedVideoId = (path: unknown): string | undefined =>
  typeof path === "string" && path.startsWith(STREAMED) ? path.slice(STREAMED.length) : undefined;

/** The audio process asks main for a song's address; `fresh` skips one main may have kept. */
export interface ResolveEvent {
  readonly event: "resolve";
  readonly id: number;
  readonly videoId: string;
  readonly fresh: boolean;
}

/** The outputs the system has now, sent as the process starts and when the list changes. */
export interface OutputsEvent {
  readonly event: "outputs";
  readonly outputs: readonly OutputDevice[];
}

/** Main's answer to a `ResolveEvent`. */
export type ResolveAnswer =
  | { readonly resolved: number; readonly address: ResolvedStream }
  | { readonly resolved: number; readonly error: AudioFailure };

export type AudioCall =
  | "load"
  | "play"
  | "pause"
  | "seek"
  | "status"
  | "preload"
  | "setVolume"
  | "setCrossfade"
  | "setNormalize"
  | "measure"
  | "cancelMeasurements"
  /** The output to play on by its id, or none for the system's default. */
  | "setOutput"
  /** The YT Music songs to fetch ahead for the Buffer, as video ids in playing order. */
  | "buffer";

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

export const failure = (error: unknown): AudioFailure => {
  const text = error instanceof Error ? error.message : String(error);
  const coded = /^\[([a-z-]+)\] (.*)$/s.exec(text);
  return coded === null
    ? { code: "engine", message: text }
    : { code: coded[1] ?? "engine", message: coded[2] ?? text };
};

/** Structured clone keeps `undefined` in an array as is; a null from elsewhere means none too. */
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined);

const run = (engine: AddonEngine, request: AudioRequest): PlaybackStatus | undefined => {
  const [first, second, third, fourth] = request.args;
  switch (request.call) {
    case "load":
      return engine.load(String(first), text(second), finite(third));
    case "preload":
      engine.preload(text(first), text(second), finite(third), flag(fourth));
      return engine.status();
    case "setVolume":
      engine.setVolume(Number(first));
      return engine.status();
    case "setCrossfade":
      engine.setCrossfade(Number(first));
      return engine.status();
    case "setNormalize":
      engine.setNormalize(first === true);
      return engine.status();
    case "measure":
      engine.measure(String(first), String(second));
      return engine.status();
    case "cancelMeasurements":
      engine.cancelMeasurements();
      return engine.status();
    case "setOutput":
      engine.setOutput?.(text(first));
      return engine.status();
    case "play":
      engine.play();
      return engine.status();
    case "pause":
      engine.pause();
      return engine.status();
    case "seek":
      engine.seek(Number(first));
      return engine.status();
    case "status":
    // Only the streaming side fetches ahead; an engine by itself has nothing to do for it.
    case "buffer":
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
 * What the process pushes to main at [atMs]: the engine's status, the moves it made and the
 * measurements it finished since [previous], or nothing when none of them changed.
 */
export const playbackEvent = (
  engine: AddonEngine,
  previous: PlaybackStatus | undefined,
  atMs: number,
): PlaybackEvent | undefined => {
  const status = engine.status();
  const transitions = engine.transitions();
  const measurements = engine.measurements();
  const moved = transitions.length > 0 || measurements.length > 0;
  if (previous !== undefined && !moved && sameStatus(previous, status)) return undefined;
  const event: PlaybackEvent = {
    event: "playback",
    status: { ...status, observedAtMs: atMs },
    transitions,
  };
  return measurements.length > 0 ? { ...event, measurements } : event;
};

/** The engine's outputs when they aren't [previous], for the process to push to main. */
export const outputsEvent = (
  engine: AddonEngine,
  previous: readonly OutputDevice[] | undefined,
): OutputsEvent | undefined => {
  const outputs = engine.outputs?.() ?? [];
  const same =
    previous !== undefined &&
    previous.length === outputs.length &&
    outputs.every((output, at) => {
      const before = previous[at];
      return before?.id === output.id && before.name === output.name;
    });
  return same ? undefined : { event: "outputs", outputs };
};
