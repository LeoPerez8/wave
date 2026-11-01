import {
  RECOGNIZE_WINDOW_MS,
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
  /** Sends the signature of the latest [windowMs] [session] has heard; [last] stops its capture first. */
  readonly ask: (session: number, last: boolean, windowMs: number) => Promise<RecognizeAnswer>;
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
  /** Whether Wave is in the foreground now (Android's system dialogs hide it). */
  readonly foreground: () => boolean;
  /** A monotonic clock, in milliseconds. */
  readonly now: () => number;
  /** Calls [tick] every [ms] until the returned stop is called. */
  readonly every: (ms: number, tick: () => void) => () => void;
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
  /**
   * Cancels and closes a hidden listening card, except while Android's microphone
   * permission or phone-audio consent dialog is what hides it.
   */
  readonly cancelOnBackground: () => boolean;
  /** Settles after the capture and lookup end and the one session log line is written. */
  readonly done: Promise<void>;
}

let lastRequest = 0;

/** How often the session's clock ticks, for Core's deadlines (`stepRecognize`). */
const TICK_MS = 500;

/** A native rejection's code (`ERR_RECOGNIZE_…`), if it has one. */
const errorCode = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

/**
 * Runs one Recognize session from [source], showing each state of its card through
 * [show]: listening, then how it ended (no card for Cancel, which closes it). Offline it
 * says so without capturing; without the microphone it says that. Core's schedule
 * (`stepRecognize`) decides when to ask and what the answers mean; this wires it to
 * the native capture, pauses Wave's playback while the microphone listens, and
 * writes the session's one app log line. When the session cancels itself (Core ends
 * it as Cancel because Wave was hidden as its capture stopped), it calls [close].
 */
export const startRecognizeSession = <L extends RecognizeTrack, S extends YtSong>(
  deps: RecognizeDeps<L, S>,
  source: RecognizeSource | "auto",
  show: (card: RecognizeCard<L, S>) => void,
  close: () => void,
): RecognizeRun => {
  let session: RecognizeSession = startRecognize(source === "auto" ? "microphone" : source);
  const request = ++lastRequest;
  let nativeId: number | null = null;
  let release: (() => void) | null = null;
  const unsubscribes: (() => void)[] = [];
  let finished = false;
  let completed = false;
  // Android's permission or consent dialog is up: it pauses Wave without leaving it.
  let awaitingDialog = false;
  let cancelRequested = false;
  // Native reports that came before `start` named the session, kept until it does.
  let startSettled = false;
  const early: { id: number; event: RecognizeEvent }[] = [];
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
    stopClock();
    early.length = 0;
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
    if (outcome.kind === "cancelled" && !cancelRequested) close();
  };

  const step = (event: RecognizeEvent): void => {
    if (finished) return;
    const next = stepRecognize(session, event);
    session = next.session;
    if (session.ended !== null) return finish(session.ended);
    const id = nativeId;
    if (next.ask === null || id === null) return;
    deps.native.ask(id, next.ask.last, RECOGNIZE_WINDOW_MS).then(
      (answer) => step({ kind: "answer", answer }),
      // The native side couldn't sign or send what it heard: an answer that ends the
      // session, even after the last ask. A session that's gone means its capture is
      // over; anything else (ERR_RECOGNIZE_ASK) went wrong reading or sending it.
      (error: unknown) =>
        step({
          kind: "answer",
          answer: {
            kind: "failed",
            failure: errorCode(error) === "ERR_RECOGNIZE_ENDED" ? "capture" : "unreadable",
            status: null,
          },
        }),
    );
  };

  const tick = (): void => step({ kind: "tick", atMs: deps.now(), foreground: deps.foreground() });

  /** A capture failure is judged with the clock as it is when it arrives. */
  const fromNative = (event: RecognizeEvent): void => {
    if (event.kind === "captureFailed") tick();
    step(event);
  };

  /** Passes on a native report for this session, keeping any that come before its id. */
  const reported = (id: number, event: RecognizeEvent): void => {
    if (finished) return;
    if (nativeId === null) {
      if (!startSettled) early.push({ id, event });
    } else if (id === nativeId) fromNative(event);
  };

  const failCapture = (): void => fromNative({ kind: "captureFailed" });

  const stopClock = deps.every(TICK_MS, tick);
  tick();

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
      awaitingDialog = true;
      const permission = await deps.microphone().finally(() => {
        awaitingDialog = false;
      });
      if (finished) return;
      if (permission === "denied") return finish({ kind: "denied" });
    }
    if (recognizeHoldsPlayback(session.source)) {
      const held = await deps.holdPlayback();
      if (finished) return held();
      release = held;
    }
    unsubscribes.push(
      deps.native.onHeard((id, heardMs, audible) =>
        reported(id, { kind: "heard", ms: heardMs, audible }),
      ),
      deps.native.onCaptureFailed((id) => reported(id, { kind: "captureFailed" })),
    );
    try {
      awaitingDialog = session.source === "playback";
      const id = await deps.native.start(session.source, request);
      startSettled = true;
      if (finished) return deps.native.stop(id);
      nativeId = id;
      for (const report of early.splice(0)) if (report.id === id) fromNative(report.event);
    } catch (error) {
      startSettled = true;
      early.length = 0;
      const code = errorCode(error);
      if (code === "ERR_RECOGNIZE_CONSENT") step({ kind: "consentDeclined" });
      // Native ends a start still binding its service when Wave goes to the background.
      else if (code === "ERR_RECOGNIZE_ENDED") step({ kind: "cancel" });
      // Any other failure is Cancel too when Wave is still hidden a moment later (Core).
      else failCapture();
    } finally {
      awaitingDialog = false;
    }
  };

  void run().catch(failCapture);
  const cancel = (): void => {
    cancelRequested = true;
    if (finished && !completed && session.ended?.kind === "match") {
      lookupAbort.abort();
      complete(session.ended, "cancelled");
    } else step({ kind: "cancel" });
  };
  return {
    cancel,
    cancelOnBackground: () => {
      if (awaitingDialog && !finished) return false;
      cancel();
      return true;
    },
    done,
  };
};
