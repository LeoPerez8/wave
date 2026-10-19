/**
 * When YouTube limits Wave's downloads (docs/spec.md, Downloads, "When YouTube limits
 * downloads"): a burst of refusals across different songs, after downloads had worked, pauses
 * every YouTube download for a while, longer each time it comes back, until a download works.
 * The native journal carries the pause out; this decides it.
 */

/** How many different songs refused within [BURST_MS] make a burst. */
const YT_THROTTLE_BURST = 5;
/** The window a burst's refusals fall in. */
const YT_THROTTLE_BURST_MS = 60_000;
/** The first pause; each burst that follows one doubles it, up to [YT_THROTTLE_MAX_PAUSE_MS]. */
const YT_THROTTLE_PAUSE_MS = 2 * 60_000;
const YT_THROTTLE_MAX_PAUSE_MS = 30 * 60_000;

/** One refusal: the song YouTube refused and when (epoch ms). */
interface Refusal {
  readonly song: string;
  readonly at: number;
}

/** What the throttle remembers. */
export interface YtThrottle {
  /** Refusals within the last [YT_THROTTLE_BURST_MS], oldest first. */
  readonly recent: readonly Refusal[];
  /** How many bursts came since the last download that worked: the pause doubles with each. */
  readonly level: number;
  /** Whether a YouTube download worked this session: refusals before any are the songs', not a limit. */
  readonly succeeded: boolean;
  /** Until when YouTube downloads are paused (epoch ms); null when they aren't. */
  readonly pausedUntil: number | null;
  /** The latest journal mark read (`ytThrottleRead`): older ones are old news. */
  readonly readUpTo: number;
}

export const YT_THROTTLE_START: YtThrottle = {
  recent: [],
  level: 0,
  succeeded: false,
  pausedUntil: null,
  readUpTo: 0,
};

/**
 * A YouTube job as the journal reports it: when YouTube last refused its song (`refusedAt`)
 * and last served its stream (`servedAt`), epoch ms.
 */
export interface YtThrottleJob {
  readonly id: string;
  readonly refusedAt?: number;
  readonly servedAt?: number;
}

/**
 * [state] once it has read the marks in the journal's [jobs] it hasn't yet, in time order: each
 * refusal of a job (one song) and each stream served (a download that worked).
 */
export const ytThrottleRead = (state: YtThrottle, jobs: readonly YtThrottleJob[]): YtThrottle => {
  const marks: { readonly at: number; readonly refused: string | null }[] = [];
  for (const job of jobs) {
    if (job.refusedAt !== undefined && job.refusedAt > state.readUpTo)
      marks.push({ at: job.refusedAt, refused: job.id });
    if (job.servedAt !== undefined && job.servedAt > state.readUpTo)
      marks.push({ at: job.servedAt, refused: null });
  }
  if (marks.length === 0) return state;
  marks.sort((a, b) => a.at - b.at);
  const read = marks.reduce(
    (next, mark) =>
      mark.refused === null
        ? ytThrottleSucceeded(next)
        : ytThrottleRefused(next, mark.refused, mark.at),
    state,
  );
  return { ...read, readUpTo: marks[marks.length - 1]?.at ?? state.readUpTo };
};

/** The pause the journal keeps across restarts: until when, and the burst it came from. */
export interface YtThrottlePause {
  readonly until: number;
  readonly level: number;
}

/**
 * The throttle as Wave starts at [now], from the [pause] the journal kept (null for none) and its
 * [jobs]: a backoff under way carries on, even once its pause is over (YouTube may still be
 * limiting downloads, and the next burst pauses longer); a stream the journal shows served
 * means downloads had worked; and only marks from now on are read.
 */
export const ytThrottleRestored = (
  pause: YtThrottlePause | null,
  now: number,
  jobs: readonly YtThrottleJob[],
): YtThrottle => {
  const start = {
    ...YT_THROTTLE_START,
    succeeded: jobs.some((job) => job.servedAt !== undefined),
    readUpTo: now,
  };
  return pause === null || pause.level <= 0
    ? start
    : { ...start, level: pause.level, pausedUntil: pause.until };
};

/** How long the pause after a burst at [level] (1 for the first) lasts. */
export const ytThrottlePauseMs = (level: number): number =>
  Math.min(YT_THROTTLE_MAX_PAUSE_MS, YT_THROTTLE_PAUSE_MS * 2 ** Math.max(0, level - 1));

/**
 * [state] once YouTube refused [song] at [at]. A refusal while paused is a download that was
 * already under way and changes nothing. [YT_THROTTLE_BURST] different songs refused within
 * [YT_THROTTLE_BURST_MS], once a download worked (or during a backoff), pause YouTube.
 */
export const ytThrottleRefused = (state: YtThrottle, song: string, at: number): YtThrottle => {
  if (state.pausedUntil !== null && at < state.pausedUntil) return state;
  const recent = [
    ...state.recent.filter((refusal) => at - refusal.at < YT_THROTTLE_BURST_MS),
    { song, at },
  ];
  const songs = new Set(recent.map((refusal) => refusal.song)).size;
  if (songs < YT_THROTTLE_BURST || !(state.succeeded || state.level > 0))
    return { ...state, recent };
  const level = state.level + 1;
  return { ...state, recent: [], level, pausedUntil: at + ytThrottlePauseMs(level) };
};

/**
 * What Settings › Downloads and the download notification say while YouTube downloads are paused
 * until [pausedUntil], at [now]: the minutes to the next try, rounded up. Null when they aren't.
 */
export const ytThrottleNotice = (pausedUntil: number | null, now: number): string | null => {
  if (pausedUntil === null || pausedUntil <= now) return null;
  const minutes = Math.ceil((pausedUntil - now) / 60_000);
  return `Paused: YouTube is limiting downloads. Next try in ${minutes} min`;
};

/** [state] once a YouTube download worked: the backoff starts over. */
export const ytThrottleSucceeded = (state: YtThrottle): YtThrottle => ({
  ...state,
  recent: [],
  level: 0,
  succeeded: true,
});
