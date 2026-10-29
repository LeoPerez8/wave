/**
 * Recognize: naming a song Wave hears. The native side captures the audio and asks
 * Shazam; Core decides when to ask and what the session's answer is.
 */

/** Where the audio comes from. #771 adds the phone's own audio. */
export type RecognizeSource = "microphone";

/** How much audio each ask covers: everything heard so far, at about 4, 8 and 12 seconds. */
const RECOGNIZE_STEPS_MS: readonly number[] = [4_000, 8_000, 12_000];

/** A recognition session as the schedule sees it. */
export interface RecognizeSession {
  readonly source: RecognizeSource;
  /** Audio captured so far. */
  readonly heardMs: number;
  /** How many asks went out. */
  readonly asked: number;
  /** An ask is out and hasn't been answered. */
  readonly asking: boolean;
  /** How it ended; null while it goes on. */
  readonly ended: RecognizeEnd | null;
}

/** The song Shazam named, in the plain fields the native side reads from its answer. */
export interface RecognizedSong {
  readonly title: string;
  /** The artist credit as Shazam shows it ("Artist feat. Other"). */
  readonly artist: string;
  readonly album: string | null;
  readonly coverUrl: string | null;
  readonly isrc: string | null;
  readonly releaseYear: number | null;
}

/**
 * Why a session failed. An ask: `network` (no answer came), `refused` (an HTTP error,
 * with its status), `unreadable` (an answer that isn't a match or a no match). Or the
 * capture: `capture` (the audio stopped coming). None of them is "no match".
 */
export type RecognizeFailure = "network" | "refused" | "unreadable" | "capture";

/** What an ask was answered with, as the native side reads Shazam's answer. */
export type RecognizeAnswer =
  | { readonly kind: "match"; readonly song: RecognizedSong }
  | { readonly kind: "noMatch" }
  | {
      readonly kind: "failed";
      readonly failure: RecognizeFailure;
      /** The HTTP status of a refused ask. */
      readonly status: number | null;
    };

/** How a session ended: an answer that ends it, or Cancel. */
export type RecognizeEnd = RecognizeAnswer | { readonly kind: "cancelled" };

/** What happened in a session. */
export type RecognizeEvent =
  /** The capture has [ms] of audio in all. */
  | { readonly kind: "heard"; readonly ms: number }
  /** The ask out was answered. */
  | { readonly kind: "answer"; readonly answer: RecognizeAnswer }
  /** The capture stopped before the audio for every ask was heard. */
  | { readonly kind: "captureFailed" }
  | { readonly kind: "cancel" };

/** The session after an event, and whether to ask now (`last`: no more audio is needed after it). */
export interface RecognizeStep {
  readonly session: RecognizeSession;
  readonly ask: { readonly last: boolean } | null;
}

/** A session that has heard nothing yet. */
export const startRecognize = (source: RecognizeSource): RecognizeSession => ({
  source,
  heardMs: 0,
  asked: 0,
  asking: false,
  ended: null,
});

/** Asks now when nothing is out and the next step's audio is heard. */
const askIfDue = (session: RecognizeSession): RecognizeStep => {
  const due = RECOGNIZE_STEPS_MS[session.asked];
  if (session.asking || due === undefined || session.heardMs < due) return { session, ask: null };
  const asked = session.asked + 1;
  return {
    session: { ...session, asked, asking: true },
    ask: { last: asked === RECOGNIZE_STEPS_MS.length },
  };
};

const end = (session: RecognizeSession, ended: RecognizeEnd): RecognizeStep => ({
  session: { ...session, asking: false, ended },
  ask: null,
});

/** Moves [session] on by [event]. Once it has ended, nothing changes it. */
export const stepRecognize = (session: RecognizeSession, event: RecognizeEvent): RecognizeStep => {
  if (session.ended !== null) return { session, ask: null };
  switch (event.kind) {
    case "heard":
      return askIfDue({ ...session, heardMs: Math.max(session.heardMs, event.ms) });
    case "answer": {
      if (!session.asking) return { session, ask: null };
      const { answer } = event;
      if (answer.kind !== "noMatch" || session.asked === RECOGNIZE_STEPS_MS.length)
        return end(session, answer);
      return askIfDue({ ...session, asking: false });
    }
    case "captureFailed":
      return session.asked === RECOGNIZE_STEPS_MS.length
        ? { session, ask: null }
        : end(session, { kind: "failed", failure: "capture", status: null });
    case "cancel":
      return end(session, { kind: "cancelled" });
  }
};

/** Whether a session from [source] pauses Wave's own playback until it ends, so the microphone doesn't hear Wave. */
export const recognizeHoldsPlayback = (source: RecognizeSource): boolean => source === "microphone";

// ---------------------------------------------------------------------------
// The card

/**
 * What the Recognize card shows: listening, the session's end, or why it couldn't
 * listen (no connection before it started, the microphone permission denied).
 */
export type RecognizeCard =
  | { readonly kind: "listening" }
  | { readonly kind: "offline" }
  | { readonly kind: "denied" }
  | { readonly kind: "ended"; readonly end: RecognizeAnswer };

/** The card's buttons, in order. */
export type RecognizeCardAction = "cancel" | "done" | "close" | "tryAgain" | "openSettings";

export const RECOGNIZE_CARD_ACTION_LABELS: Readonly<Record<RecognizeCardAction, string>> = {
  cancel: "Cancel",
  done: "Done",
  close: "Close",
  tryAgain: "Try Again",
  openSettings: "Open Settings",
};

export interface RecognizeCardView {
  /** The song's title, or what's happening. */
  readonly title: string;
  /** Under the title: the artist and album, or a line saying why. */
  readonly lines: readonly string[];
  /** Shows the song's cover (a placeholder when it has none). */
  readonly cover: boolean;
  readonly coverUrl: string | null;
  /** Shows the moving wave. */
  readonly listening: boolean;
  readonly actions: readonly RecognizeCardAction[];
}

const notice = (
  title: string,
  line: string,
  action: RecognizeCardAction = "tryAgain",
): RecognizeCardView => ({
  title,
  lines: [line],
  cover: false,
  coverUrl: null,
  listening: false,
  actions: ["close", action],
});

const FAILURE_LINES: Readonly<Record<RecognizeFailure, string>> = {
  network: "The connection dropped before an answer came.",
  refused: "The recognition service turned the request down. Try again in a minute.",
  unreadable: "The recognition service sent an answer Wave can't read.",
  capture: "The microphone stopped sending sound.",
};

/** What the card shows for [card]. */
export const recognizeCardView = (card: RecognizeCard): RecognizeCardView => {
  switch (card.kind) {
    case "listening":
      return {
        title: "Listening…",
        lines: ["Hold your phone near the music."],
        cover: false,
        coverUrl: null,
        listening: true,
        actions: ["cancel"],
      };
    case "offline":
      return notice("No connection", "Connect to the internet to recognize a song.");
    case "denied":
      return notice(
        "Microphone access is off",
        "Allow Wave to use the microphone in its Android settings to recognize songs around you.",
        "openSettings",
      );
    case "ended": {
      const ending = card.end;
      switch (ending.kind) {
        case "match":
          return {
            title: ending.song.title,
            lines:
              ending.song.album === null
                ? [ending.song.artist]
                : [ending.song.artist, ending.song.album],
            cover: true,
            coverUrl: ending.song.coverUrl,
            listening: false,
            actions: ["done"],
          };
        case "noMatch":
          return notice("No match", "Wave couldn't name this song. Try again closer to the music.");
        case "failed":
          return notice("Couldn't recognize the song", FAILURE_LINES[ending.failure]);
      }
    }
  }
};

// ---------------------------------------------------------------------------
// The app log

/** How a session went for the log: its end, or why it never listened. */
export type RecognizeLogOutcome =
  RecognizeEnd | { readonly kind: "offline" } | { readonly kind: "denied" };

const SOURCE_NAMES: Readonly<Record<RecognizeSource, string>> = {
  microphone: "the microphone",
};

/**
 * The session's one app log line: the source, the seconds heard and the outcome
 * (with a refusal's HTTP status). Never the song, the audio or the signature.
 */
export const recognizeLogLine = (session: {
  readonly source: RecognizeSource;
  readonly heardMs: number;
  readonly outcome: RecognizeLogOutcome;
}): string => {
  const { outcome } = session;
  const after = `after ${(session.heardMs / 1000).toFixed(1)} s`;
  const what = (() => {
    switch (outcome.kind) {
      case "offline":
        return "offline, nothing heard";
      case "denied":
        return "microphone permission denied, nothing heard";
      case "match":
        return `a match ${after}`;
      case "noMatch":
        return `no match ${after}`;
      case "cancelled":
        return `cancelled ${after}`;
      case "failed":
        return `failed ${after} (${outcome.failure}${outcome.status === null ? "" : `, HTTP ${outcome.status}`})`;
    }
  })();
  return `Recognize through ${SOURCE_NAMES[session.source]}: ${what}`;
};
