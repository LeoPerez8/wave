/**
 * Play events: one per time a track starts playing, with how long it was
 * listened to and how it ended. A play is counted (towards play counts, Most
 * Played and the stats) once it was listened to for more than 15 seconds; a
 * song of 15 seconds or less counts when it's played to the end.
 */

import { RESTART_THRESHOLD_MS, type QueueCommand, type QueueState } from "./queue.ts";
import { RECAP_PLAY_CONTEXT } from "./recapMusic.ts";
import { parseTrackId } from "./ytMusic.ts";

/**
 * Listening longer than this counts a play; a song this long or shorter
 * counts when it's played to the end.
 */
export const COUNTED_PLAY_MS = 15_000;

/** How a play ended. */
export type PlayEndReason = "completed" | "skipped" | "stopped" | "interrupted";

/** What decides whether a play counts. */
export interface PlayListening {
  /** Time actually spent playing. */
  readonly listenedMs: number;
  /** The track's length, or null while it isn't known. */
  readonly durationMs: number | null;
  readonly endReason: PlayEndReason;
}

/**
 * Whether a play counts: listened to for more than 15 seconds, or a song of
 * 15 seconds or less played to the end. Each play event counts at most once.
 * This is the one home of the rule; the migration that recounted past plays
 * (`0007_recount_plays` in the app) mirrors it.
 */
export const isCountedPlay = ({ listenedMs, durationMs, endReason }: PlayListening): boolean =>
  listenedMs > COUNTED_PLAY_MS ||
  (listenedMs > 0 &&
    endReason === "completed" &&
    durationMs !== null &&
    durationMs > 0 &&
    durationMs <= COUNTED_PLAY_MS);

/** What a playback was started from (Core's queue context); null for Play Next / Add to Queue. */
export interface PlayContext {
  readonly kind: string;
  readonly id: string | null;
}

/**
 * Where a play was started from: `auto` when Android Auto started the
 * playback, `phone` otherwise (the app, the notification, the lock screen,
 * Bluetooth).
 */
export type PlaySource = "phone" | "auto";

/**
 * The source of the queue's plays after `command`, sent from `by`: starting
 * playback (a `play` command) credits whoever started it; anything else
 * (skips, jumps, mode changes, queue edits) keeps the source of the playback
 * going on, whoever sends it.
 */
export const queueSourceAfter = (
  current: PlaySource,
  command: QueueCommand,
  by: PlaySource,
): PlaySource => (command.type === "play" ? by : current);

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
  readonly source: PlaySource;
}

/** The track behind a player entry. */
export interface PlayTrack {
  readonly trackId: string;
  readonly context: PlayContext | null;
  /** Where the playback that reached this entry was started from. */
  readonly source: PlaySource;
}

/**
 * What the player reports, with the wall-clock time it happened at:
 * - `state`: what the player is doing (the entry key, whether it's playing).
 * - `transition`: the player moved to another entry, or repeated the current one.
 *   `crossfade`: the current song ended on its own and fades out under the next
 *   one (Settings › Playback › Crossfade); it goes on until `fadeEnded`.
 *   `toFollowing`: it moved on to the entry right after the one it left
 *   (`movedToFollowing`), as Next does.
 * - `fadeEnded`: the song fading out under the current one went silent, or
 *   was cut off.
 * - `seek`: the player jumped within entry `key`, from `fromMs` to `toMs`. Back
 *   to the start it ends the play: "previous" after three seconds (from Wave, the
 *   notification or a headset), or next past the end of the queue.
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
      readonly reason: "auto" | "repeat" | "seek" | "playlist" | "sync" | "crossfade";
      readonly toFollowing?: boolean;
    }
  | {
      readonly type: "seek";
      readonly at: number;
      readonly key: string | null;
      readonly fromMs: number;
      readonly toMs: number;
    }
  | { readonly type: "fadeEnded"; readonly at: number };

/** A seek landing this close to the start of the track replays it. */
const REPLAY_START_MS = 1000;

/**
 * Whether a seek sends the track back to its start, which ends the play: it
 * lands in the first second, from past the point where "previous" restarts.
 */
const isReplay = (fromMs: number, toMs: number): boolean =>
  toMs < REPLAY_START_MS && fromMs > RESTART_THRESHOLD_MS;

/** The play going on now. */
interface OpenPlay extends PlayTrack {
  readonly key: string;
  /** Whether it goes on record: a streamed song's play is only told to listeners as it ends. */
  readonly onRecord: boolean;
  readonly startedAt: number;
  readonly durationMs: number | null;
  /** Listened before `playingSince`. */
  readonly listenedMs: number;
  /** When it last started or resumed playing; null while paused. */
  readonly playingSince: number | null;
}

export interface PlayTrackerState {
  readonly play: OpenPlay | null;
  /** The play of the song fading out under `play` during a crossfade. */
  readonly fading: OpenPlay | null;
}

export const EMPTY_PLAY_TRACKER: PlayTrackerState = { play: null, fading: null };

/**
 * How a play ended, for whoever listens (the Magic Queue): the play, and
 * whether the owner ended it with Next, moving on to the following entry. A
 * skip by Previous, by picking another entry or by a replay isn't one.
 */
export interface PlayEnd {
  readonly play: PlayEvent;
  readonly byNext: boolean;
}

/**
 * A play starting (to be recorded at once), ending (to be recorded as
 * final), or a streamed song's play ending (`heard`: never on record, as play
 * history and stats are about the Library, but its listeners learn from it).
 */
export type PlayStep =
  | { readonly type: "started"; readonly play: PlayEvent }
  | ({ readonly type: "ended" } & PlayEnd)
  | ({ readonly type: "heard" } & PlayEnd);

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
    counted: isCountedPlay({ listenedMs, durationMs: play.durationMs, endReason }),
    source: play.source,
  };
};

/** [play]'s end at [at]: on record, or only heard for a streamed song. */
const endOf = (play: OpenPlay, at: number, reason: PlayEndReason, byNext: boolean): PlayStep => ({
  type: play.onRecord ? "ended" : "heard",
  play: toEvent(play, at, reason),
  byNext,
});

const open = (
  key: string,
  track: PlayTrack,
  at: number,
  durationMs: number | null,
  onRecord: boolean,
): OpenPlay => ({
  key,
  onRecord,
  trackId: track.trackId,
  context: track.context,
  source: track.source,
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
 * paused. Null when nothing is playing, or only a streamed song (never on record).
 */
export const playSoFar = (state: PlayTrackerState, at: number): PlayEvent | null =>
  state.play?.onRecord === true ? toEvent(state.play, at, cutShort(state.play)) : null;

/** The play of the song fading out during a crossfade as it should be on record at `at` (see `playSoFar`). */
export const fadingPlaySoFar = (state: PlayTrackerState, at: number): PlayEvent | null =>
  state.fading?.onRecord === true ? toEvent(state.fading, at, cutShort(state.fading)) : null;

/**
 * Whether a play's end is still to come with the queue on [currentKey]: the
 * play open is another entry's (the player's move hasn't reached the
 * tracker yet), or a song is fading out under the current one.
 */
export const playEndPending = (state: PlayTrackerState, currentKey: string | null): boolean =>
  state.fading !== null || (state.play !== null && state.play.key !== currentKey);

/**
 * Whether going from entry [fromKey] to [toKey] of [queue] moved on to the
 * entry right after the one left, as Next does. Moving back, jumping
 * further on, or leaving an entry no longer queued isn't.
 */
export const movedToFollowing = (
  queue: QueueState,
  fromKey: string | null,
  toKey: string | null,
): boolean => {
  if (fromKey === null || toKey === null) return false;
  const from = queue.entries.findIndex((entry) => entry.key === fromKey);
  return from >= 0 && queue.entries[from + 1]?.key === toKey;
};

const sameContext = (a: PlayContext | null, b: PlayContext | null): boolean =>
  a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id;

/**
 * Picks a recorded play back up when Wave's JS restarted while the player kept
 * going, so one listen isn't split in two: it goes on from what was listened
 * when the player is still on its track, from the same context, and it hadn't
 * ended (it's on record as interrupted or stopped). Null otherwise. Time spent
 * playing while JS was away isn't known, so it isn't counted.
 */
export const resumePlay = (
  recorded: PlayEvent,
  signal: Extract<PlaybackSignal, { type: "state" }>,
): PlayTrackerState | null => {
  const { key, track } = signal;
  if (key === null || track === null) return null;
  if (signal.status === "idle" || signal.status === "ended") return null;
  if (recorded.endReason !== "interrupted" && recorded.endReason !== "stopped") return null;
  if (recorded.trackId !== track.trackId || !sameContext(recorded.context, track.context)) {
    return null;
  }
  return {
    play: {
      key,
      onRecord: true,
      trackId: track.trackId,
      context: track.context,
      // The play on record keeps where it was started from.
      source: recorded.source,
      startedAt: recorded.startedAt,
      durationMs: signal.durationMs ?? recorded.durationMs,
      listenedMs: recorded.listenedMs,
      playingSince: signal.playing ? signal.at : null,
    },
    fading: null,
  };
};

/**
 * The entry whose play on record goes on when JS picks the queue back up with
 * the player on `currentKey` (see `resumePlay`): that entry when the player
 * kept playing while JS restarted; none when the player resumed the saved
 * queue itself after a cold start (`resumedByPlayer`), as its plays are new.
 */
export const keptPlayingEntry = (
  currentKey: string | null,
  { resumedByPlayer }: { readonly resumedByPlayer: boolean },
): string | null => (resumedByPlayer ? null : currentKey);

/** Starts or stops the listening clock. */
const setPlaying = (play: OpenPlay, playing: boolean, at: number): OpenPlay => {
  if (playing === (play.playingSince !== null)) return play;
  return playing
    ? { ...play, playingSince: at }
    : { ...play, listenedMs: listenedAt(play, at), playingSince: null };
};

/** The current play following `signal`; a crossfade's outgoing play is left to `trackPlays`. */
const trackCurrentPlay = (
  play: OpenPlay | null,
  signal: Exclude<PlaybackSignal, { type: "fadeEnded" }>,
): PlayTrackerResult => {
  const end = (ending: OpenPlay, reason: PlayEndReason, byNext = false): PlayTrackerResult => ({
    state: EMPTY_PLAY_TRACKER,
    steps: [endOf(ending, signal.at, reason, byNext)],
  });
  const unchanged: PlayTrackerResult = { state: { play, fading: null }, steps: [] };

  switch (signal.type) {
    case "transition": {
      if (play === null) return unchanged;
      const playedThrough = signal.reason === "auto" || signal.reason === "repeat";
      return playedThrough
        ? end(play, "completed")
        : end(play, "skipped", signal.toFollowing === true);
    }
    case "seek":
      if (play === null || signal.key !== play.key) return unchanged;
      return isReplay(signal.fromMs, signal.toMs) ? end(play, "skipped") : unchanged;
    case "state": {
      if (play !== null) {
        // Playback went away (an error, the queue cleared, the player stopped).
        if (signal.status === "idle") return end(play, cutShort(play));
        if (signal.key !== play.key) {
          // The transition went missing; the player is on another entry all the same.
          const ended = end(play, "skipped");
          const next = trackCurrentPlay(null, signal);
          return { state: next.state, steps: [...ended.steps, ...next.steps] };
        }
        if (signal.status === "ended") return end(play, "completed");
        let next = setPlaying(play, signal.playing, signal.at);
        if (signal.durationMs !== null && signal.durationMs !== next.durationMs) {
          next = { ...next, durationMs: signal.durationMs };
        }
        return next === play ? unchanged : { state: { play: next, fading: null }, steps: [] };
      }
      if (!signal.playing || signal.key === null || signal.track === null) return unchanged;
      // A Recap's music is never followed: watching a Recap mustn't add to what it reports.
      if (signal.track.context?.kind === RECAP_PLAY_CONTEXT.kind) return unchanged;
      // Play history and stats are about the Library: streamed songs are never on record.
      const onRecord = parseTrackId(signal.track.trackId)?.kind !== "yt";
      const started = open(signal.key, signal.track, signal.at, signal.durationMs, onRecord);
      return {
        state: { play: started, fading: null },
        steps: onRecord
          ? [{ type: "started", play: toEvent(started, signal.at, cutShort(started)) }]
          : [],
      };
    }
  }
};

/**
 * Follows the player and reports each play as it starts and ends. Pure: feed
 * it every signal in order and record the steps it returns.
 *
 * With crossfade, a song ending on its own keeps playing under the next one:
 * its play goes on, paused and resumed with the player, until its fade ends
 * (completed, as its end came on its own), the player moves on again or
 * playback goes away.
 */
export const trackPlays = (state: PlayTrackerState, signal: PlaybackSignal): PlayTrackerResult => {
  const { play, fading } = state;
  const fadeOut = (reason: PlayEndReason): PlayStep[] =>
    fading === null ? [] : [endOf(fading, signal.at, reason, false)];

  if (signal.type === "fadeEnded")
    return { state: { play, fading: null }, steps: fadeOut("completed") };
  if (signal.type === "transition" && signal.reason === "crossfade") {
    return { state: { play: null, fading: play }, steps: fadeOut("completed") };
  }
  const current = trackCurrentPlay(play, signal);
  if (fading === null) return current;
  if (signal.type === "transition") {
    return { state: current.state, steps: [...fadeOut("completed"), ...current.steps] };
  }
  if (signal.type === "state" && signal.status === "idle") {
    return { state: current.state, steps: [...fadeOut(cutShort(fading)), ...current.steps] };
  }
  const stillFading =
    signal.type === "state" ? setPlaying(fading, signal.playing, signal.at) : fading;
  return { state: { ...current.state, fading: stillFading }, steps: current.steps };
};
