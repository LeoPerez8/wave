import { en, type Catalogue } from "./catalogueEn.ts";
import {
  recognizeResultActions,
  type RecognizeResult,
  type RecognizeTrack,
  type RecognizeResultAction,
  type RecognizeResultOptions,
} from "./recognition.ts";
import { joinArtists, type YtSong } from "./ytMusic.ts";

/**
 * Recognize: naming a song Wave hears. The native side captures the audio and asks
 * Shazam; Core decides when to ask and what the session's answer is.
 */

/** Where the audio comes from. Playback capture excludes Wave's own audio. */
export type RecognizeSource = "microphone" | "playback";

/** Android hides player identities; discount Wave's active players from the media count. */
export const recognizeSource = (activity: {
  readonly activeMediaPlayers: number;
  readonly waveMediaPlayers: number;
}): RecognizeSource =>
  activity.activeMediaPlayers > activity.waveMediaPlayers ? "playback" : "microphone";

/**
 * How much audio an ask covers: the latest 12 seconds, or everything heard before that.
 * It stays under 15 seconds because ShazamIO warns Shazam returns no matches for that long.
 */
export const RECOGNIZE_WINDOW_MS = 12_000;

/** How much more audio Wave hears between asks. */
const RECOGNIZE_STEP_MS = 4_000;
/** The last ask: with its answer, a session that hasn't found the song ends at about 30 seconds. */
const RECOGNIZE_LAST_ASK_MS = 28_000;

const RECOGNIZE_STEPS_MS: readonly number[] = Array.from(
  { length: RECOGNIZE_LAST_ASK_MS / RECOGNIZE_STEP_MS },
  (_, index) => (index + 1) * RECOGNIZE_STEP_MS,
);
const LAST_STEP_MS = RECOGNIZE_STEPS_MS.at(-1)!;

/**
 * The session's clock, counted only while Wave is in the foreground (Android's
 * consent dialog hides it). Audio that doesn't advance for this long, before every
 * step's audio is heard, ends the session as a capture failure: a read that blocks,
 * a start that never settles, a capture failure that never reached JS.
 */
const RECOGNIZE_STALL_MS = 3_000;
/**
 * An ask unanswered for this long ends the session as no answer. The native request
 * times out on its own (15 s to connect, 15 s to read); this covers one that never settles.
 */
const RECOGNIZE_ASK_DEADLINE_MS = 35_000;
/**
 * How long a stopped capture waits before it's a failure. Hiding Wave stops the
 * capture too, and that report may reach JS before the app state does: a capture
 * that stopped and is followed by a hidden Wave within this time is Cancel.
 */
const RECOGNIZE_CAPTURE_END_GRACE_MS = 1_000;

/** A recognition session as the schedule sees it. */
export interface RecognizeSession {
  readonly source: RecognizeSource;
  /** Audio captured so far. */
  readonly heardMs: number;
  /** How many of the schedule's steps are done: a step an answer outlasted counts. */
  readonly asked: number;
  /** An ask is out and hasn't been answered. */
  readonly asking: boolean;
  /** The last tick's clock reading; null before the first. */
  readonly clockMs: number | null;
  /** Foreground time since the first tick. */
  readonly listenedMs: number;
  /** [listenedMs] when the audio last advanced. */
  readonly progressMs: number;
  /** [listenedMs] when the ask out went out. */
  readonly askedMs: number;
  /** [listenedMs] when the capture stopped on its own; null while it goes on. */
  readonly captureEndedMs: number | null;
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
export type RecognizeEnd =
  | RecognizeAnswer
  | { readonly kind: "cancelled" }
  | { readonly kind: "blocked" }
  | { readonly kind: "consentDeclined" };

/** What happened in a session. */
export type RecognizeEvent =
  /** The capture has [ms] of audio in all. */
  | { readonly kind: "heard"; readonly ms: number; readonly audible?: boolean }
  /** The ask out was answered. */
  | { readonly kind: "answer"; readonly answer: RecognizeAnswer }
  /** The capture stopped before the audio for every ask was heard. */
  | { readonly kind: "captureFailed" }
  /**
   * The controller's clock (any monotonic milliseconds) at [atMs], about twice a
   * second, and whether Wave is in the foreground now.
   */
  | { readonly kind: "tick"; readonly atMs: number; readonly foreground: boolean }
  | { readonly kind: "consentDeclined" }
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
  clockMs: null,
  listenedMs: 0,
  progressMs: 0,
  askedMs: 0,
  captureEndedMs: null,
  ended: null,
});

const CAPTURE_FAILURE: RecognizeAnswer = { kind: "failed", failure: "capture", status: null };

/**
 * Asks now when nothing is out and a new step's audio is heard (and can still be signed).
 * It goes for the latest step heard, so slow answers can't stretch the session.
 */
const askIfDue = (session: RecognizeSession): RecognizeStep => {
  const asked = RECOGNIZE_STEPS_MS.filter((ms) => ms <= session.heardMs).length;
  if (session.asking || session.captureEndedMs !== null || asked <= session.asked)
    return { session, ask: null };
  return {
    session: { ...session, asked, asking: true, askedMs: session.listenedMs },
    ask: { last: asked === RECOGNIZE_STEPS_MS.length },
  };
};

/** Ends a session whose capture stopped once nothing is out and the grace has passed. */
const endStoppedCapture = (session: RecognizeSession): RecognizeStep =>
  session.captureEndedMs !== null &&
  !session.asking &&
  session.listenedMs - session.captureEndedMs >= RECOGNIZE_CAPTURE_END_GRACE_MS
    ? end(session, CAPTURE_FAILURE)
    : { session, ask: null };

/** Moves the clock to [atMs]; the deadlines it passes end the session. */
const tickRecognize = (
  session: RecognizeSession,
  atMs: number,
  foreground: boolean,
): RecognizeStep => {
  const elapsed = session.clockMs === null ? 0 : Math.max(0, atMs - session.clockMs);
  const ticked: RecognizeSession = {
    ...session,
    clockMs: atMs,
    listenedMs: session.listenedMs + (foreground ? elapsed : 0),
  };
  if (ticked.captureEndedMs !== null) {
    // Hiding Wave stopped the capture: that's Cancel, whichever report came first.
    if (!foreground) return end(ticked, { kind: "cancelled" });
    if (!ticked.asking) return endStoppedCapture(ticked);
  } else if (
    ticked.heardMs < LAST_STEP_MS &&
    ticked.listenedMs - ticked.progressMs >= RECOGNIZE_STALL_MS
  )
    return end(ticked, CAPTURE_FAILURE);
  if (ticked.asking && ticked.listenedMs - ticked.askedMs >= RECOGNIZE_ASK_DEADLINE_MS)
    return end(ticked, { kind: "failed", failure: "network", status: null });
  return { session: ticked, ask: null };
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
      // `audible` covers everything captured so far, including the first window.
      if (
        session.source === "playback" &&
        session.asked === 0 &&
        event.ms >= RECOGNIZE_STEPS_MS[0]! &&
        event.audible === false
      )
        return end({ ...session, heardMs: event.ms }, { kind: "blocked" });
      if (event.ms <= session.heardMs) return { session, ask: null };
      return askIfDue({ ...session, heardMs: event.ms, progressMs: session.listenedMs });
    case "answer": {
      if (!session.asking) return { session, ask: null };
      const { answer } = event;
      if (answer.kind !== "noMatch" || session.asked === RECOGNIZE_STEPS_MS.length)
        return end(session, answer);
      // A capture that stopped can't hear the next step: it ends once its grace is over.
      if (session.captureEndedMs !== null) return endStoppedCapture({ ...session, asking: false });
      return askIfDue({ ...session, asking: false });
    }
    case "captureFailed":
      // After the last ask nothing more is needed; with an ask out, its answer still counts.
      if (session.asked === RECOGNIZE_STEPS_MS.length || session.captureEndedMs !== null)
        return { session, ask: null };
      return { session: { ...session, captureEndedMs: session.listenedMs }, ask: null };
    case "tick":
      return tickRecognize(session, event.atMs, event.foreground);
    case "cancel":
      return end(session, { kind: "cancelled" });
    case "consentDeclined":
      return end(session, { kind: "consentDeclined" });
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
export type RecognizeCard<L extends RecognizeTrack = RecognizeTrack, S extends YtSong = YtSong> =
  | { readonly kind: "listening"; readonly source?: RecognizeSource }
  | { readonly kind: "offline" }
  | { readonly kind: "denied" }
  | {
      readonly kind: "ended";
      readonly end: RecognizeAnswer | { readonly kind: "blocked" | "consentDeclined" };
    }
  | { readonly kind: "resolving"; readonly song: RecognizedSong }
  | { readonly kind: "resolved"; readonly result: RecognizeResult<L, S> };

/** The card's buttons, in order. */
export type RecognizeCardAction =
  | "cancel"
  | "done"
  | "close"
  | "tryAgain"
  | "openSettings"
  | "useMicrophone"
  | RecognizeResultAction;

/** The card's button labels in [catalogue]'s language. */
export const recognizeCardActionLabels = (
  catalogue: Catalogue = en,
): Readonly<Record<RecognizeCardAction, string>> => {
  const text = catalogue.playbackText;
  return {
    play: text.play,
    playNext: text.playNext,
    addToShazam: text.addToShazam,
    addToPlaylist: text.addToPlaylist,
    goToAlbum: text.goToAlbum,
    download: text.download,
    cancelDownload: text.cancelDownload,
    retryDownload: text.retryDownload,
    listenAgain: text.listenAgain,
    cancel: text.cancel,
    done: text.done,
    close: text.close,
    tryAgain: text.tryAgain,
    openSettings: text.openSettings,
    useMicrophone: text.useMicrophone,
  };
};

/** The card's button labels in English. */
export const RECOGNIZE_CARD_ACTION_LABELS = recognizeCardActionLabels(en);

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

const failureLines = (catalogue: Catalogue): Readonly<Record<RecognizeFailure, string>> => ({
  network: catalogue.playbackText.theConnectionDroppedBeforeAnAnswerCame,
  refused: catalogue.playbackText.theRecognitionServiceTurnedTheRequestDownTryAgainInAMinute,
  unreadable: catalogue.playbackText.theRecognitionServiceSentAnAnswerWaveCantRead,
  capture: catalogue.playbackText.theAudioCaptureStoppedSendingSound,
});

/** What the card shows for [card]. */
export const recognizeCardView = (
  card: RecognizeCard,
  options: RecognizeResultOptions = {
    ytMusic: true,
  },
  catalogue: Catalogue = en,
): RecognizeCardView => {
  switch (card.kind) {
    case "resolving":
      return {
        title: card.song.title,
        lines: [card.song.artist, ...(card.song.album === null ? [] : [card.song.album])],
        cover: true,
        coverUrl: card.song.coverUrl,
        listening: false,
        actions: ["close", "listenAgain"],
      };
    case "resolved": {
      const { song } = card.result;
      return {
        title: song.title,
        lines: [
          card.result.kind === "library" ? card.result.track.artist : joinArtists(song.artists),
          ...(song.album === null ? [] : [song.album]),
        ],
        cover: true,
        coverUrl: song.artworkUrl,
        listening: false,
        actions: recognizeResultActions(card.result, options),
      };
    }
    case "listening":
      return {
        title: catalogue.playbackText.listening,
        lines: [
          card.source === "playback"
            ? catalogue.playbackText.listeningToAudioFromThisPhone
            : catalogue.playbackText.holdYourPhoneNearTheMusic,
        ],
        cover: false,
        coverUrl: null,
        listening: true,
        actions: ["cancel"],
      };
    case "offline":
      return notice(
        catalogue.playbackText.noConnection,
        catalogue.playbackText.connectToTheInternetToRecognizeASong,
      );
    case "denied":
      return notice(
        catalogue.playbackText.microphoneAccessIsOff,
        catalogue.playbackText.allowWaveToCaptureAudioInItsAndroidSettingsToRecognizeSongs,
        "openSettings",
      );
    case "ended": {
      const ending = card.end;
      switch (ending.kind) {
        case "blocked":
          return notice(
            catalogue.playbackText.thisAppBlocksAudioCapture,
            catalogue.playbackText.tryTheMicrophoneToRecognizeMusicAroundYou,
            "useMicrophone",
          );
        case "consentDeclined":
          return notice(
            catalogue.playbackText.phoneAudioAccessDeclined,
            catalogue.playbackText.allowAndroidsCaptureRequestToRecognizeAudioFromThisPhone,
          );
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
          return notice(
            catalogue.playbackText.noMatch,
            catalogue.playbackText.waveCouldntNameThisSongTryListeningAgain,
          );
        case "failed":
          return notice(
            catalogue.playbackText.couldntRecognizeTheSong,
            failureLines(catalogue)[ending.failure],
          );
      }
    }
  }
};
