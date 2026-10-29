import {
  recognizeHoldsPlayback,
  recognizeLogLine,
  startRecognize,
  stepRecognize,
  type RecognizeAnswer,
  type RecognizeCard,
  type RecognizeEvent,
  type RecognizeLogOutcome,
  type RecognizeSession,
  type RecognizeSource,
} from "@wave/core";

/** The native half of Recognize (`WaveRecognize`, `recognize/RecognizeModule.kt`). */
export interface RecognizeNative {
  /** Starts capturing from [source]; the session's id. Rejects when it can't capture. */
  readonly start: (source: RecognizeSource) => Promise<number>;
  /** Sends the signature of everything [session] has heard; [last] stops its capture first. */
  readonly ask: (session: number, last: boolean) => Promise<RecognizeAnswer>;
  readonly stop: (session: number) => void;
  /** How much a session has heard in all; returns the unsubscribe. */
  readonly onHeard: (listener: (session: number, heardMs: number) => void) => () => void;
  /** A session's audio stopped on its own. */
  readonly onCaptureFailed: (listener: (session: number) => void) => () => void;
}

export interface RecognizeDeps {
  /** Whether the phone is online now. */
  readonly online: () => boolean;
  /** Whether Wave may use the microphone, asking Android on first use. */
  readonly microphone: () => Promise<"granted" | "denied">;
  /** Pauses Wave's playback if it's playing; the release resumes it (and does nothing otherwise). */
  readonly holdPlayback: () => Promise<() => void>;
  readonly native: RecognizeNative;
  /** Writes one line to the app log: a warning for a failure, information otherwise. */
  readonly log: (level: "info" | "warn", line: string) => void;
}

export interface RecognizeRun {
  /** Ends the session as cancelled; the card closes. Nothing once it has ended. */
  readonly cancel: () => void;
  /** Settles once the session has ended, its capture stopped and playback given back. */
  readonly done: Promise<void>;
}

/**
 * Runs one Recognize session from [source], showing each state of its card through
 * [show]: listening, then how it ended (no card for Cancel, which closes it). Offline it
 * says so without capturing; without the microphone it says that. Core's schedule
 * (`stepRecognize`) decides when to ask and what the answers mean; this wires it to
 * the native capture, pauses Wave's playback while the microphone listens, and
 * writes the session's one app log line.
 */
export const startRecognizeSession = (
  deps: RecognizeDeps,
  source: RecognizeSource,
  show: (card: RecognizeCard) => void,
): RecognizeRun => {
  let session: RecognizeSession = startRecognize(source);
  let nativeId: number | null = null;
  let release: (() => void) | null = null;
  const unsubscribes: (() => void)[] = [];
  let finished = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  /** Ends the session once: stops the capture, gives playback back, logs and shows the end. */
  const finish = (outcome: RecognizeLogOutcome): void => {
    if (finished) return;
    finished = true;
    for (const unsubscribe of unsubscribes) unsubscribe();
    if (nativeId !== null) deps.native.stop(nativeId);
    release?.();
    const line = recognizeLogLine({ source, heardMs: session.heardMs, outcome });
    deps.log(outcome.kind === "failed" ? "warn" : "info", line);
    if (outcome.kind === "offline" || outcome.kind === "denied") show({ kind: outcome.kind });
    else if (outcome.kind !== "cancelled") show({ kind: "ended", end: outcome });
    resolveDone();
  };

  const step = (event: RecognizeEvent): void => {
    if (finished) return;
    const next = stepRecognize(session, event);
    session = next.session;
    if (session.ended !== null) return finish(session.ended);
    const id = nativeId;
    if (next.ask === null || id === null) return;
    deps.native.ask(id, next.ask.last).then(
      (answer) => step({ kind: "answer", answer }),
      // The native side couldn't sign or send what it heard (its session is gone): an
      //  answer that ends the session, even after the last ask, when the capture is over.
      () => step({ kind: "answer", answer: { kind: "failed", failure: "capture", status: null } }),
    );
  };

  const run = async (): Promise<void> => {
    show({ kind: "listening" });
    if (!deps.online()) return finish({ kind: "offline" });
    if (source === "microphone") {
      const permission = await deps.microphone();
      if (finished) return;
      if (permission === "denied") return finish({ kind: "denied" });
    }
    if (recognizeHoldsPlayback(source)) {
      const held = await deps.holdPlayback();
      if (finished) return held();
      release = held;
    }
    unsubscribes.push(
      deps.native.onHeard((id, heardMs) => {
        if (id === nativeId) step({ kind: "heard", ms: heardMs });
      }),
      deps.native.onCaptureFailed((id) => {
        if (id === nativeId) step({ kind: "captureFailed" });
      }),
    );
    try {
      const id = await deps.native.start(source);
      if (finished) return deps.native.stop(id);
      nativeId = id;
    } catch {
      step({ kind: "captureFailed" });
    }
  };

  void run();
  return { cancel: () => step({ kind: "cancel" }), done };
};
