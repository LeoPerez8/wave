/**
 * The performance log a perf build of the app keeps (docs/performance/README.md):
 * marks, touches, render counts and platform timings, buffered in memory and
 * written to logcat in one flush once the app has been quiet for
 * `PERF_FLUSH_QUIET_MS` after its last touch. A measured window opens with a
 * touch and closes before that, so logging never lands inside one. The runner
 * (scripts/perf) reads the flushes back with `parsePerfLog`.
 *
 * The app flushes on its own because anything the runner could send it (a link,
 * a share) pauses and resumes the activity, and Wave reacts to coming back to the
 * foreground (sync, rescans): that work would land in the next window.
 *
 * Times are `performance.now()` milliseconds. On Android that clock and a touch's
 * native timestamp are both CLOCK_MONOTONIC, the clock gfxinfo's frame timestamps
 * use too, so the runner can line them up.
 */

/** What every perf log line starts with. */
export const PERF_LOG_TAG = "WavePerf";

/**
 * How long after its last touch (or flush) the app waits before it flushes. A
 * measured window must close sooner after its last touch (the runner's default
 * window is 2.5 s).
 */
export const PERF_FLUSH_QUIET_MS = 4_000;

/**
 * What a render counted while the app was away (in the background, the screen
 * off) is reported under: `away:SongRow`, `away:js:sync.run`. A screen-off
 * window's flush comes after the app is back, so its own work and the catch-up
 * on return are told apart by name.
 */
export const PERF_AWAY_PREFIX = "away:";

/** One thing a perf build noticed. Times in ms (`performance.now()`). */
export type PerfEntry =
  | { readonly kind: "mark"; readonly name: string; readonly detail?: string; readonly at: number }
  /** A touch reached JavaScript at [at]; Android timestamped it at [eventAt]. */
  | { readonly kind: "touch"; readonly eventAt: number; readonly at: number }
  /** A long task from the platform's PerformanceObserver. */
  | { readonly kind: "longtask"; readonly at: number; readonly duration: number }
  /** An event timing from the platform's PerformanceObserver. */
  | {
      readonly kind: "event";
      readonly name: string;
      readonly at: number;
      readonly duration: number;
      readonly processingStart: number;
      readonly processingEnd: number;
    };

/** Platform timings `PerfRecorder.timing` takes. */
export type PerfTiming = Extract<PerfEntry, { kind: "longtask" | "event" }>;

/** Values a flush reports about the app as it is (Library size, build, heap). */
export type PerfMeta = Readonly<Record<string, string | number | boolean | null>>;

/** One flush read back from logcat. */
export interface PerfFlush {
  /** The flush's number since the app started: "1", "2"… */
  readonly tag: string;
  readonly meta: PerfMeta;
  readonly entries: readonly PerfEntry[];
  /** Renders per component since the previous flush. */
  readonly renders: Readonly<Record<string, number>>;
  /** Entries the full buffer let go before this flush. */
  readonly dropped: number;
  /** False when the end line never arrived (logcat dropped it, or the app died). */
  readonly complete: boolean;
}

export interface PerfRecorder {
  mark(name: string, detail?: string): void;
  /** A touch Android timestamped at [eventAt] (the event's native timestamp, ms). */
  touch(eventAt: number): void;
  /** One render of [component]; counted under `PERF_AWAY_PREFIX` while the app is away. */
  render(component: string): void;
  /**
   * Whether the app is away (in the background) from now on. Coming back counts
   * as activity, like a touch: no flush for the quiet time after it.
   */
  away(away: boolean): void;
  timing(entry: PerfTiming): void;
  /**
   * Whether to flush now: the app hasn't flushed yet, or has something to say,
   * and has had no touch or flush for the quiet time.
   */
  dueForFlush(): boolean;
  /** Everything since the last drain as log lines, with [meta]; then empties. */
  drain(meta?: PerfMeta): readonly string[];
}

/** The most entries a recorder holds between flushes, unless told otherwise. */
const DEFAULT_CAPACITY = 5_000;

const round = (ms: number): number => Math.round(ms * 100) / 100;

type Line =
  | {
      readonly flush: "begin";
      readonly tag: string;
      readonly meta: PerfMeta;
      readonly dropped: number;
    }
  | { readonly flush: "end"; readonly tag: string }
  | { readonly renders: Readonly<Record<string, number>> }
  | { readonly entry: PerfEntry };

const line = (value: Line): string => `${PERF_LOG_TAG} ${JSON.stringify(value)}`;

export const createPerfRecorder = (options: {
  readonly now: () => number;
  readonly capacity?: number;
  readonly quietMs?: number;
}): PerfRecorder => {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const quietMs = options.quietMs ?? PERF_FLUSH_QUIET_MS;
  let entries: PerfEntry[] = [];
  let renders = new Map<string, number>();
  let dropped = 0;
  let flushes = 0;
  let prefix = "";
  // A touch, a return or a flush: the quiet time counts from the latest, or from the start.
  let lastActivity = options.now();
  const now = (): number => round(options.now());
  const add = (entry: PerfEntry): void => {
    entries.push(entry);
    if (entries.length > capacity) {
      entries.shift();
      dropped++;
    }
  };
  return {
    mark: (name, detail) =>
      add(
        detail === undefined
          ? { kind: "mark", name, at: now() }
          : { kind: "mark", name, detail, at: now() },
      ),
    touch: (eventAt) => {
      lastActivity = options.now();
      add({ kind: "touch", eventAt: round(eventAt), at: now() });
    },
    render: (component) => {
      const name = prefix + component;
      renders.set(name, (renders.get(name) ?? 0) + 1);
    },
    away: (away) => {
      // Coming back counts as activity: the return's catch-up joins the away window's flush.
      if (!away && prefix !== "") lastActivity = options.now();
      prefix = away ? PERF_AWAY_PREFIX : "";
    },
    timing: (entry) => add(entry),
    dueForFlush: () =>
      (flushes === 0 || entries.length > 0 || renders.size > 0) &&
      options.now() - lastActivity >= quietMs,
    drain: (meta = {}) => {
      flushes++;
      lastActivity = options.now();
      const tag = String(flushes);
      const lines = [
        line({ flush: "begin", tag, meta, dropped }),
        ...entries.map((entry) => line({ entry })),
        line({ renders: Object.fromEntries(renders) }),
        line({ flush: "end", tag }),
      ];
      entries = [];
      renders = new Map();
      dropped = 0;
      return lines;
    },
  };
};

const parseLine = (text: string): Line | null => {
  const start = text.indexOf(`${PERF_LOG_TAG} `);
  if (start < 0) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start + PERF_LOG_TAG.length + 1));
    return typeof value === "object" && value !== null ? (value as Line) : null;
  } catch {
    return null;
  }
};

/** The flushes in [text] (logcat output, any format that keeps the message whole), in order. */
export const parsePerfLog = (text: string): readonly PerfFlush[] => {
  const flushes: PerfFlush[] = [];
  let open: {
    tag: string;
    meta: PerfMeta;
    dropped: number;
    entries: PerfEntry[];
    renders: Record<string, number>;
  } | null = null;
  const close = (complete: boolean): void => {
    if (open !== null) flushes.push({ ...open, complete });
    open = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const parsed = parseLine(raw);
    if (parsed === null) continue;
    if ("flush" in parsed && parsed.flush === "begin") {
      close(false);
      open = {
        tag: parsed.tag,
        meta: parsed.meta,
        dropped: parsed.dropped,
        entries: [],
        renders: {},
      };
    } else if (open === null) {
      continue;
    } else if ("flush" in parsed) {
      if (parsed.tag === open.tag) close(true);
    } else if ("renders" in parsed) {
      Object.assign(open.renders, parsed.renders);
    } else if ("entry" in parsed) {
      open.entries.push(parsed.entry);
    }
  }
  close(false);
  return flushes;
};
