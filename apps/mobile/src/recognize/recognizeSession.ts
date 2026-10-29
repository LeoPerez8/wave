import {
  recognizeHoldsPlayback,
  recognizeLogLine,
  recognizeSource,
  resolveRecognizedSong,
  startRecognize,
  stepRecognize,
  type RecognizeAnswer,
  type RecognizedSong,
  type RecognizeLookup,
  type RecognizeResolution,
  type RecognizeTrack,
  type YtSong,
  type RecognizeCard,
  type RecognizeEvent,
  type RecognizeLogOutcome,
  type RecognizeSession,
  type RecognizeSource,
} from "@wave/core";

/** The native half of Recognize (`WaveRecognize`, `recognize/RecognizeModule.kt`). */
export interface RecognizeNative {
  readonly playbackActivity: () => Promise<{
    activeMediaPlayers: number;
    waveMediaPlayers: number;
  }>;
  /** Starts capturing from [source]; the session's id. Rejects when it can't capture. */
  readonly start: (source: RecognizeSource, request: number) => Promise<number>;
  /** Cancels a start still waiting for consent or for its foreground service. */
  readonly cancelStart: (request: number) => void;
  /** Sends the signature of everything [session] has heard; [last] stops its capture first. */
  readonly ask: (session: number, last: boolean) => Promise<RecognizeAnswer>;
  readonly stop: (session: number) => void;
  /** How much a session has heard in all; returns the unsubscribe. */
  readonly onHeard: (
    listener: (session: number, heardMs: number, audible: boolean) => void,
  ) => () => void;
  /** A session's audio stopped on its own. */
  readonly onCaptureFailed: (listener: (session: number) => void) => () => void;
}

export interface RecognizeDeps<
  L extends RecognizeTrack = RecognizeTrack,
  S extends YtSong = YtSong,
> {
  /** Whether the phone is online now. */
  readonly online: () => boolean;
  /** RECORD_AUDIO permission, required by Android for either source. */
  readonly microphone: () => Promise<"granted" | "denied">;
  /** Pauses Wave's playback if it's playing; the release resumes it (and does nothing otherwise). */
  readonly holdPlayback: () => Promise<() => void>;
  readonly native: RecognizeNative;
  /** Resolves a match against the Library, then one Songs search under the shared allowance. */
  readonly resolve: (
    song: RecognizedSong,
    signal: AbortSignal,
  ) => Promise<RecognizeResolution<L, S>>;
  /** Writes one line to the app log: a warning for a failure, information otherwise. */
  readonly log: (level: "info" | "warn", line: string) => void;
}

export interface RecognizeRun {
  /** Cancels capture or the pending lookup. Does nothing after the result is shown. */
  readonly cancel: () => void;
  /** Settles after the capture and lookup end and the one session log line is written. */
  readonly done: Promise<void>;
}

let lastRequest = 0;

/**
 * Runs one Recognize session from [source], showing each state of its card through
 * [show]: listening, then how it ended (no card for Cancel, which closes it). Offline it
 * says so without capturing; without the microphone it says that. Core's schedule
 * (`stepRecognize`) decides when to ask and what the answers mean; this wires it to
 * the native capture, pauses Wave's playback while the microphone listens, and
 * writes the session's one app log line.
 */
export const startRecognizeSession = <L extends RecognizeTrack, S extends YtSong>(
  deps: RecognizeDeps<L, S>,
  source: RecognizeSource | "auto",
  show: (card: RecognizeCard<L, S>) => void,
): RecognizeRun => {
  let session: RecognizeSession = startRecognize(source === "auto" ? "microphone" : source);
  const request = ++lastRequest;
  let nativeId: number | null = null;
  let release: (() => void) | null = null;
  const unsubscribes: (() => void)[] = [];
  let finished = false;
  let completed = false;
  const lookupAbort = new AbortController();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const complete = (outcome: RecognizeLogOutcome, lookup?: RecognizeLookup): void => {
    if (completed) return;
    completed = true;
    deps.log(
      outcome.kind === "failed" || lookup === "failed" ? "warn" : "info",
      recognizeLogLine({
        source: session.source,
        heardMs: session.heardMs,
        outcome,
        ...(lookup === undefined ? {} : { lookup }),
      }),
    );
    resolveDone();
  };

  /** Stops capture and releases playback before looking up a match. */
  const finish = (outcome: RecognizeLogOutcome): void => {
    if (finished) return;
    finished = true;
    for (const unsubscribe of unsubscribes) unsubscribe();
    deps.native.cancelStart(request);
    if (nativeId !== null) deps.native.stop(nativeId);
    release?.();
    if (outcome.kind === "match") {
      show({ kind: "resolving", song: outcome.song });
      void Promise.resolve()
        .then(() => deps.resolve(outcome.song, lookupAbort.signal))
        .catch(() => {
          const fallback = resolveRecognizedSong<L, S>(outcome.song, [], {
            ok: false,
            reason: "failed",
          });
          if (fallback.kind !== "resolved") throw new Error("Recognition fallback needs no search");
          return fallback;
        })
        .then((resolution) => {
          if (completed) return;
          show({ kind: "resolved", result: resolution.result });
          complete(outcome, resolution.lookup);
        });
      return;
    }
    if (outcome.kind === "offline" || outcome.kind === "denied") show({ kind: outcome.kind });
    else if (outcome.kind !== "cancelled") show({ kind: "ended", end: outcome });
    complete(outcome);
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
    show(source === "playback" ? { kind: "listening", source } : { kind: "listening" });
    if (!deps.online()) return finish({ kind: "offline" });
    if (source === "auto") {
      const activity = await deps.native.playbackActivity();
      if (finished) return;
      session = startRecognize(recognizeSource(activity));
      show({ kind: "listening", source: session.source });
    }
    // Android requires RECORD_AUDIO for playback capture too, even though no microphone is opened.
    {
      const permission = await deps.microphone();
      if (finished) return;
      if (permission === "denied") return finish({ kind: "denied" });
    }
    if (recognizeHoldsPlayback(session.source)) {
      const held = await deps.holdPlayback();
      if (finished) return held();
      release = held;
    }
    unsubscribes.push(
      deps.native.onHeard((id, heardMs, audible) => {
        if (id === nativeId) step({ kind: "heard", ms: heardMs, audible });
      }),
      deps.native.onCaptureFailed((id) => {
        if (id === nativeId) step({ kind: "captureFailed" });
      }),
    );
    try {
      const id = await deps.native.start(session.source, request);
      if (finished) return deps.native.stop(id);
      nativeId = id;
    } catch (error) {
      step({
        kind:
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ERR_RECOGNIZE_CONSENT"
            ? "consentDeclined"
            : "captureFailed",
      });
    }
  };

  void run().catch(() => step({ kind: "captureFailed" }));
  return {
    cancel: () => {
      if (finished && !completed && session.ended?.kind === "match") {
        lookupAbort.abort();
        complete(session.ended, "cancelled");
      } else step({ kind: "cancel" });
    },
    done,
  };
};
