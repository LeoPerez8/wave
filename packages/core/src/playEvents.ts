/**
 * Play events: one per time a track starts playing, with how long it was
 * listened to and how it ended. A play is counted (towards play counts and
 * Most Played) once it was listened to for half the track or four minutes,
 * whichever comes first.
 */

/** Listening this long counts a play whatever the track's length. */
export const COUNTED_PLAY_MS = 240_000;

/** Whether a play counts: ≥ 50% of the track or ≥ 4 minutes listened. */
export const isCountedPlay = (listenedMs: number, durationMs: number | null): boolean =>
  listenedMs > 0 &&
  (listenedMs >= COUNTED_PLAY_MS ||
    (durationMs !== null && durationMs > 0 && listenedMs * 2 >= durationMs));

/** How a play ended. */
export type PlayEndReason = "completed" | "skipped" | "stopped" | "interrupted";

/** What a playback was started from (Core's queue context); null for Play Next / Add to Queue. */
export interface PlayContext {
  readonly kind: string;
  readonly id: string | null;
}

/** One play of a track, as the library stores it. */
export interface PlayEvent {
  readonly trackId: string;
  readonly context: PlayContext | null;
  /** Wall-clock time (ms) the track started playing. */
  readonly startedAt: number;
  /** Time actually spent playing; seeking ahead doesn't add to it. */
  readonly listenedMs: number;
  /** The track's length, or null while the player doesn't know it. */
  readonly durationMs: number | null;
  readonly endReason: PlayEndReason;
  readonly counted: boolean;
}

/** The track behind a player entry. */
export interface PlayTrack {
  readonly trackId: string;
  readonly context: PlayContext | null;
}

/**
 * What the player reports, with the wall-clock time it happened at:
 * - `state`: what the player is doing (the entry key, whether it's playing).
 * - `transition`: the player moved to another entry, or repeated the current one.
 * - `restart`: Wave sent the current entry back to its start (previous after
 *   three seconds, or next past the end of the queue).
 */
export type PlaybackSignal =
  | {
      readonly type: "state";
      readonly at: number;
      readonly key: string | null;
      readonly status: "idle" | "buffering" | "ready" | "ended";
      readonly playing: boolean;
      readonly durationMs: number | null;
      /** The track behind `key`, or null when it's unknown. */
      readonly track: PlayTrack | null;
    }
  | {
      readonly type: "transition";
      readonly at: number;
      readonly key: string | null;
      readonly reason: "auto" | "repeat" | "seek" | "playlist" | "sync";
    }
  | { readonly type: "restart"; readonly at: number };

/** The play going on now. */
interface OpenPlay extends PlayTrack {
  readonly key: string;
  readonly startedAt: number;
  readonly durationMs: number | null;
  /** Listened before `playingSince`. */
  readonly listenedMs: number;
  /** When it last started or resumed playing; null while paused. */
  readonly playingSince: number | null;
}

export interface PlayTrackerState {
  readonly play: OpenPlay | null;
}

export const EMPTY_PLAY_TRACKER: PlayTrackerState = { play: null };

/** A play starting (to be recorded at once) or ending (to be recorded as final). */
export type PlayStep =
  | { readonly type: "started"; readonly play: PlayEvent }
  | { readonly type: "ended"; readonly play: PlayEvent };

export interface PlayTrackerResult {
  readonly state: PlayTrackerState;
  readonly steps: readonly PlayStep[];
}

const listenedAt = (play: OpenPlay, at: number): number =>
  play.listenedMs + (play.playingSince === null ? 0 : Math.max(0, at - play.playingSince));

const toEvent = (play: OpenPlay, at: number, endReason: PlayEndReason): PlayEvent => {
  const listenedMs = listenedAt(play, at);
  return {
    trackId: play.trackId,
    context: play.context,
    startedAt: play.startedAt,
    listenedMs,
    durationMs: play.durationMs,
    endReason,
    counted: isCountedPlay(listenedMs, play.durationMs),
  };
};

const open = (key: string, track: PlayTrack, at: number, durationMs: number | null): OpenPlay => ({
  key,
  trackId: track.trackId,
  context: track.context,
  startedAt: at,
  durationMs,
  listenedMs: 0,
  playingSince: at,
});

/**
 * How a play ends when playback goes away under it: interrupted while it was
 * playing (an error, Wave's process dying), stopped once it had been paused.
 */
const cutShort = (play: OpenPlay): PlayEndReason =>
  play.playingSince === null ? "stopped" : "interrupted";

/**
 * The play going on now as it should be on record at `at`, in case it never
 * gets to end (Wave's process dies): interrupted while playing, stopped while
 * paused. Null when nothing is playing.
 */
export const playSoFar = (state: PlayTrackerState, at: number): PlayEvent | null =>
  state.play === null ? null : toEvent(state.play, at, cutShort(state.play));

/** Starts or stops the listening clock. */
const setPlaying = (play: OpenPlay, playing: boolean, at: number): OpenPlay => {
  if (playing === (play.playingSince !== null)) return play;
  return playing
    ? { ...play, playingSince: at }
    : { ...play, listenedMs: listenedAt(play, at), playingSince: null };
};

/**
 * Follows the player and reports each play as it starts and ends. Pure: feed
 * it every signal in order and record the steps it returns.
 */
export const trackPlays = (state: PlayTrackerState, signal: PlaybackSignal): PlayTrackerResult => {
  const { play } = state;
  const end = (ending: OpenPlay, reason: PlayEndReason): PlayTrackerResult => ({
    state: EMPTY_PLAY_TRACKER,
    steps: [{ type: "ended", play: toEvent(ending, signal.at, reason) }],
  });
  const unchanged: PlayTrackerResult = { state, steps: [] };

  switch (signal.type) {
    case "transition": {
      if (play === null) return unchanged;
      const playedThrough = signal.reason === "auto" || signal.reason === "repeat";
      return end(play, playedThrough ? "completed" : "skipped");
    }
    case "restart":
      return play === null ? unchanged : end(play, "skipped");
    case "state": {
      if (play !== null) {
        // Playback went away (an error, the queue cleared, the player stopped).
        if (signal.status === "idle") return end(play, cutShort(play));
        if (signal.key !== play.key) {
          // The transition went missing; the player is on another entry all the same.
          const ended = end(play, "skipped");
          const next = trackPlays(ended.state, signal);
          return { state: next.state, steps: [...ended.steps, ...next.steps] };
        }
        if (signal.status === "ended") return end(play, "completed");
        let next = setPlaying(play, signal.playing, signal.at);
        if (signal.durationMs !== null && signal.durationMs !== next.durationMs) {
          next = { ...next, durationMs: signal.durationMs };
        }
        return next === play ? unchanged : { state: { play: next }, steps: [] };
      }
      if (!signal.playing || signal.key === null || signal.track === null) return unchanged;
      const started = open(signal.key, signal.track, signal.at, signal.durationMs);
      return {
        state: { play: started },
        steps: [{ type: "started", play: toEvent(started, signal.at, cutShort(started)) }],
      };
    }
  }
};
