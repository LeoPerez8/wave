/**
 * Recognize on main's side (docs/spec.md › Recognize): the phone's session
 * (`@wave/client/recognizeSession`) over the JVM's Shazam client (`DesktopRecognize.kt`), with
 * the audio the window captures. Main decides what is captured: only the session it names, from
 * the source picked, until that session stops.
 */
import { Buffer } from "node:buffer";
import {
  startRecognizeSession,
  type RecognizeNative,
  type RecognizeRun,
} from "@wave/client/recognizeSession";
import type {
  RecognizeAnswer,
  RecognizeCard,
  RecognizedSong,
  RecognizeResolution,
  RecognizeSource,
  RecognizeTrack,
  YtSong,
} from "@wave/core";
import type { KotlinEvent } from "../kotlin/protocol.ts";
import type {
  RecognizeCapture,
  RecognizeCaptureEnd,
  RecognizeCaptureVia,
} from "../../shared/recognize.ts";

/** The JVM's `recognize.*` calls (`DesktopRecognize.call`). */
export type RecognizeKotlinMethod =
  "recognize.start" | "recognize.audio" | "recognize.end" | "recognize.ask" | "recognize.stop";

export interface DesktopRecognizePorts<L extends RecognizeTrack, S extends YtSong = YtSong> {
  readonly kotlin: (method: RecognizeKotlinMethod, params: object) => Promise<unknown>;
  /** What the JVM tells main unasked: `recognizeHeard` and `recognizeCaptureFailed`. */
  readonly events: (listener: (event: KotlinEvent) => void) => () => void;
  readonly online: () => boolean;
  /** The system's switch for apps' use of the microphone. */
  readonly microphone: () => "granted" | "denied";
  /** How this system's own sound is captured. */
  readonly systemAudio: Exclude<RecognizeCaptureVia, "microphone">;
  /** The app's language as a tag, for Shazam's answer. */
  readonly locale: () => string;
  readonly playback: {
    readonly playing: () => boolean;
    readonly pause: () => Promise<void>;
    readonly play: () => Promise<void>;
  };
  /** The Library first, then one YT Music search (`resolveRecognition`). */
  readonly resolve: (
    song: RecognizedSong,
    signal: AbortSignal,
  ) => Promise<RecognizeResolution<L, S>>;
  readonly log: (level: "info" | "warn", line: string) => void;
  readonly now?: () => number;
  readonly every?: (ms: number, tick: () => void) => () => void;
}

export interface RecognizeState<L extends RecognizeTrack, S extends YtSong = YtSong> {
  readonly open: boolean;
  readonly attempt: number;
  readonly source: RecognizeSource;
  readonly card: RecognizeCard<L, S>;
  readonly capture: RecognizeCapture | null;
}

export interface DesktopRecognize<L extends RecognizeTrack, S extends YtSong = YtSong> {
  /** Opens the card listening from [source], cancelling the session before. */
  readonly start: (source: RecognizeSource) => void;
  readonly state: () => RecognizeState<L, S>;
  /** Ends the session and closes the card. */
  readonly close: () => void;
  readonly audio: (session: number, pcm: Uint8Array) => void;
  readonly captureEnded: (session: number, why: RecognizeCaptureEnd) => void;
  /** Whether the window may capture [kind] now: only for the session capturing it. */
  readonly allows: (kind: "microphone" | "systemAudio") => boolean;
  /** Ends any session, for the app quitting. */
  readonly dispose: () => void;
}

const isEvent = (event: KotlinEvent, name: string): event is KotlinEvent & { session: number } =>
  event.event === name && typeof event["session"] === "number";

export const createDesktopRecognize = <L extends RecognizeTrack, S extends YtSong = YtSong>(
  ports: DesktopRecognizePorts<L, S>,
): DesktopRecognize<L, S> => {
  let open = false;
  let attempt = 0;
  let source: RecognizeSource = "microphone";
  let card: RecognizeCard<L, S> = { kind: "listening" };
  let capture: RecognizeCapture | null = null;
  let run: RecognizeRun | null = null;
  let lastSession = 0;
  // Audio pieces go to the JVM one after another, in the order they were heard.
  let sending: Promise<unknown> = Promise.resolve();
  const send = (method: RecognizeKotlinMethod, params: object) => {
    sending = sending.then(() => ports.kotlin(method, params)).catch(() => undefined);
    return sending;
  };

  const native: RecognizeNative = {
    // The source is always picked on the desktop.
    playbackActivity: async () => ({ activeMediaPlayers: 0, waveMediaPlayers: 0 }),
    start: async (picked) => {
      const session = ++lastSession;
      await ports.kotlin("recognize.start", { session, locale: ports.locale() });
      capture = { session, via: picked === "microphone" ? "microphone" : ports.systemAudio };
      return session;
    },
    cancelStart: () => {},
    ask: async (session, last, windowMs) =>
      (await ports.kotlin("recognize.ask", { session, last, windowMs })) as RecognizeAnswer,
    stop: (session) => {
      if (capture?.session === session) capture = null;
      void send("recognize.stop", { session });
    },
    onHeard: (listener) =>
      ports.events((event) => {
        if (isEvent(event, "recognizeHeard") && typeof event["heardMs"] === "number")
          listener(event.session, event["heardMs"], event["audible"] !== false);
      }),
    onCaptureFailed: (listener) =>
      ports.events((event) => {
        if (isEvent(event, "recognizeCaptureFailed")) listener(event.session);
      }),
  };

  const start = (picked: RecognizeSource): void => {
    run?.cancel();
    open = true;
    source = picked;
    const current = ++attempt;
    card = picked === "playback" ? { kind: "listening", source: picked } : { kind: "listening" };
    run = startRecognizeSession<L, S>(
      {
        online: ports.online,
        // Wave on the desktop keeps listening behind other windows: they may be what plays.
        foreground: () => true,
        now: ports.now ?? (() => performance.now()),
        every:
          ports.every ??
          ((ms, tick) => {
            const timer = setInterval(tick, ms);
            return () => clearInterval(timer);
          }),
        microphone: async () => (picked === "microphone" ? ports.microphone() : "granted"),
        holdPlayback: async () => {
          if (!ports.playback.playing()) return () => {};
          await ports.playback.pause();
          return () => void ports.playback.play().catch(() => undefined);
        },
        native,
        resolve: ports.resolve,
        log: ports.log,
      },
      picked,
      (shown) => {
        if (current === attempt) card = shown;
      },
      () => {
        if (current === attempt) open = false;
      },
    );
  };

  const close = (): void => {
    attempt++;
    run?.cancel();
    run = null;
    open = false;
    capture = null;
  };

  return {
    start,
    state: () => ({ open, attempt, source, card, capture }),
    close,
    audio: (session, pcm) => {
      if (capture?.session !== session || pcm.length === 0) return;
      void send("recognize.audio", { session, pcm: Buffer.from(pcm).toString("base64") });
    },
    captureEnded: (session, why) => {
      if (capture?.session !== session) return;
      capture = null;
      if (why === "failed") {
        // The JVM reports it as the session's capture failure, after the audio before it.
        void send("recognize.end", { session });
        return;
      }
      // The system refused the window the microphone: the session ends, the card says why.
      const current = attempt;
      run?.cancel();
      run = null;
      if (current === attempt) card = { kind: "denied" };
    },
    allows: (kind) => capture !== null && (kind === "systemAudio") === (capture.via === "loopback"),
    dispose: close,
  };
};
