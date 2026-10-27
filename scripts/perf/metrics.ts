// What one measured step's frames and perf log say (stepMetrics), how a run's steps
// sum up per scenario (summarize), and how two runs compare (compareSummaries).
// docs/performance/README.md defines each metric.
import type { PerfEntry, PerfFlush } from "../../packages/core/src/index.ts";
import { FRAME_PARTS, type GfxFrame, type GfxSummary, type ThreadSwitches } from "./device.ts";

type Part = (typeof FRAME_PARTS)[number];

/** One part of the step's kept frames (`FrameParts`). */
export interface PartStats {
  /** Kept frames that had this part's timestamps. */
  readonly frames: number;
  readonly meanMs: number | null;
  readonly p90Ms: number | null;
  readonly maxMs: number | null;
}

/** The mark a step waits for: its first occurrence after the touch is the response. */
export interface Expect {
  readonly mark: string;
  /** When set, only a mark whose detail equals it. */
  readonly detail?: string;
}

/** A quiet spell this long between frames ends a step's frame burst. */
const SETTLE_GAP_MS = 250;

export interface FrameStats {
  /** Frames rendered in the step, from gfxinfo's totals (every frame, not only those kept). */
  readonly total: number;
  readonly deadlineMissed: number;
  readonly jankyFrames: number;
  readonly slowUiThread: number;
  readonly highInputLatency: number;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
  readonly p99Ms: number | null;
  /** The longest frame gfxinfo kept, in ms. */
  readonly maxMs: number | null;
  readonly histogram: readonly (readonly [number, number])[];
}

export interface StepMetrics {
  /** The touch's native timestamp (ms, CLOCK_MONOTONIC); null without a perf build. */
  readonly touchAt: number | null;
  /** From the touch to JavaScript's touch handler. */
  readonly inputToJsMs: number | null;
  /** From the touch to the first frame that finished rendering after it: the first visible response. */
  readonly firstFrameMs: number | null;
  /** From the touch to the expected mark (route shown, keyboard up, Now Playing shown). */
  readonly responseMs: number | null;
  /** From the touch to the last frame before the screen went quiet. */
  readonly settleMs: number | null;
  /** First to last frame of the response burst; needs no perf build. */
  readonly burstMs: number | null;
  /** Whether the expected mark never came; null when the step expects none or the build has no marks. */
  readonly expectMissing: boolean | null;
  /** False when gfxinfo dropped frames from before the touch's response (it keeps 120 per window). */
  readonly framesCovered: boolean;
  /** The last route marked in the step. */
  readonly finalRoute: string | null;
  readonly frames: FrameStats;
  /**
   * Where the kept frames' time went, part by part (UI thread pre-draw and layout,
   * UI thread draw, RenderThread sync and issue, GPU). Attributes glass cost.
   * Results from before frame parts existed don't have it.
   */
  readonly frameParts: Readonly<Record<Part, PartStats>>;
  readonly renders: Readonly<Record<string, number>>;
  readonly longTasks: { readonly count: number; readonly totalMs: number; readonly maxMs: number };
  /**
   * From the touch to the first mark of each phase the step names (React done
   * with a tab, its layout...); null for a phase that didn't come. Results from
   * before phases existed don't have it.
   */
  readonly phasesMs?: Readonly<Record<string, number | null>>;
}

const round = (value: number): number => Math.round(value * 100) / 100;

const sinceTouch = (at: number | null, touchAt: number | null): number | null =>
  at === null || touchAt === null ? null : round(at - touchAt);

/** The frames that answered the touch: from the first after it until the screen goes quiet. */
const burstOf = (frames: readonly GfxFrame[], touchAt: number | null): GfxFrame[] => {
  const sorted = frames.toSorted((a, b) => a.intendedVsyncMs - b.intendedVsyncMs);
  const start = sorted.findIndex((frame) => touchAt === null || frame.completedMs > touchAt);
  if (start < 0) return [];
  const burst = [sorted[start] as GfxFrame];
  for (const frame of sorted.slice(start + 1)) {
    const last = burst[burst.length - 1] as GfxFrame;
    if (frame.intendedVsyncMs - last.completedMs > SETTLE_GAP_MS) break;
    burst.push(frame);
  }
  return burst;
};

const frameStats = (summary: GfxSummary, frames: readonly GfxFrame[]): FrameStats => {
  const missedKept = frames.filter(
    (frame) => frame.deadlineMs !== null && frame.completedMs > frame.deadlineMs,
  ).length;
  const durations = frames.map((frame) => frame.completedMs - frame.intendedVsyncMs);
  return {
    total: summary.totalFrames ?? frames.length,
    deadlineMissed: summary.frameDeadlineMissed ?? missedKept,
    jankyFrames: summary.jankyFrames ?? 0,
    slowUiThread: summary.slowUiThread ?? 0,
    highInputLatency: summary.highInputLatency ?? 0,
    p50Ms: summary.p50Ms,
    p90Ms: summary.p90Ms,
    p99Ms: summary.p99Ms,
    maxMs: durations.length === 0 ? null : round(Math.max(...durations)),
    histogram: summary.histogram,
  };
};

const partStats = (frames: readonly GfxFrame[]): Record<Part, PartStats> =>
  Object.fromEntries(
    FRAME_PARTS.map((part): [Part, PartStats] => {
      const values = frames
        .map((frame) => frame.parts[part])
        .filter((value): value is number => value !== null)
        .toSorted((a, b) => a - b);
      const n = values.length;
      return [
        part,
        n === 0
          ? { frames: 0, meanMs: null, p90Ms: null, maxMs: null }
          : {
              frames: n,
              meanMs: round(values.reduce((sum, value) => sum + value, 0) / n),
              p90Ms: values[Math.ceil(0.9 * n) - 1] ?? null,
              maxMs: values[n - 1] ?? null,
            },
      ];
    }),
  ) as Record<Part, PartStats>;

const touches = (entries: readonly PerfEntry[]) =>
  entries.filter((entry): entry is Extract<PerfEntry, { kind: "touch" }> => entry.kind === "touch");

const marks = (entries: readonly PerfEntry[]) =>
  entries.filter((entry): entry is Extract<PerfEntry, { kind: "mark" }> => entry.kind === "mark");

export const stepMetrics = (step: {
  readonly frames: readonly GfxFrame[];
  readonly summary: GfxSummary;
  /** The step's flush; null when the app isn't a perf build. */
  readonly flush: PerfFlush | null;
  readonly expect: Expect | undefined;
  /** Which touch the latencies count from: the first (default) or the last (rapid taps). */
  readonly anchor?: "first" | "last";
  /**
   * For a step with no touch (typed keys): the mark latencies count from, its
   * first occurrence in the step.
   */
  readonly from?: Expect | undefined;
  /** Marks to time from the touch (or the `from` mark), each to its first occurrence after it. */
  readonly phases?: readonly string[];
}): StepMetrics => {
  const entries = step.flush?.entries ?? [];
  const stepTouches = touches(entries);
  const touch = step.anchor === "last" ? stepTouches[stepTouches.length - 1] : stepTouches[0];
  const fromMark =
    touch !== undefined || step.from === undefined
      ? undefined
      : marks(entries).find(
          (mark) =>
            mark.name === step.from?.mark &&
            (step.from.detail === undefined || mark.detail === step.from.detail),
        );
  // What latencies count from: the touch, or the step's own mark when it has no touch.
  const anchorAt = touch?.eventAt ?? fromMark?.at ?? null;
  const burst = burstOf(step.frames, anchorAt);
  const first = burst[0];
  const last = burst[burst.length - 1];
  const interval = first?.intervalMs ?? 16.7;
  // gfxinfo keeps 120 frames a window: when it rendered more, the earliest may be gone.
  const dropped = (step.summary.totalFrames ?? 0) > step.frames.length;
  const framesCovered =
    !dropped ||
    anchorAt === null ||
    (first !== undefined && first.intendedVsyncMs <= anchorAt + 2 * interval);
  const expected =
    step.expect === undefined || anchorAt === null
      ? undefined
      : marks(entries).find(
          (mark) =>
            mark.at >= anchorAt &&
            mark.name === step.expect?.mark &&
            (step.expect.detail === undefined || mark.detail === step.expect.detail),
        );
  const routes = marks(entries).filter((mark) => mark.name === "route");
  const longTasks = entries.filter(
    (entry): entry is Extract<PerfEntry, { kind: "longtask" }> => entry.kind === "longtask",
  );
  return {
    touchAt: touch?.eventAt ?? null,
    inputToJsMs: touch === undefined ? null : round(touch.at - touch.eventAt),
    firstFrameMs: framesCovered ? sinceTouch(first?.completedMs ?? null, anchorAt) : null,
    responseMs: sinceTouch(expected?.at ?? null, anchorAt),
    settleMs: framesCovered ? sinceTouch(last?.completedMs ?? null, anchorAt) : null,
    burstMs:
      first === undefined || last === undefined
        ? null
        : round(last.completedMs - first.intendedVsyncMs),
    expectMissing: step.expect === undefined || step.flush === null ? null : expected === undefined,
    framesCovered,
    finalRoute: routes[routes.length - 1]?.detail ?? null,
    frames: frameStats(step.summary, step.frames),
    frameParts: partStats(step.frames),
    renders: step.flush?.renders ?? {},
    longTasks: {
      count: longTasks.length,
      totalMs: round(longTasks.reduce((sum, task) => sum + task.duration, 0)),
      maxMs: longTasks.reduce((max, task) => Math.max(max, task.duration), 0),
    },
    ...(step.phases === undefined
      ? {}
      : {
          phasesMs: Object.fromEntries(
            step.phases.map((phase) => {
              const mark =
                anchorAt === null
                  ? undefined
                  : marks(entries).find((entry) => entry.at >= anchorAt && entry.name === phase);
              return [phase, sinceTouch(mark?.at ?? null, anchorAt)];
            }),
          ),
        }),
  };
};

/** The names React Native gives its JavaScript thread: the new architecture's, then the old one's. */
const JS_THREADS = ["mqt_v_js", "mqt_js"] as const;

/** How often the app's threads woke over a window (a screen-off soak's), per minute. */
export interface Wakeups {
  readonly minutes: number;
  /** The JavaScript thread's name; null when the process had none. */
  readonly jsThread: string | null;
  readonly jsPerMinute: number | null;
  /** Every thread of the process, the JavaScript thread included. */
  readonly processPerMinute: number;
  /** The threads that woke most, busiest first (five at most). */
  readonly top: readonly { readonly name: string; readonly perMinute: number }[];
}

/**
 * The wake-ups between two readings of the app's threads [windowMs] apart. A
 * thread born in the window counts all its switches; one that ended in it is
 * lost, as its count went with it.
 */
export const threadWakeups = (
  before: ReadonlyMap<string, ThreadSwitches>,
  after: ReadonlyMap<string, ThreadSwitches>,
  windowMs: number,
): Wakeups => {
  const minutes = windowMs / 60_000;
  const perMinute = (count: number): number => round(count / minutes);
  const woke = [...after].map(([tid, { name, switches }]) => ({
    name,
    count: Math.max(0, switches - (before.get(tid)?.switches ?? 0)),
  }));
  const js = woke.find((thread) => (JS_THREADS as readonly string[]).includes(thread.name));
  return {
    minutes: round(minutes),
    jsThread: js?.name ?? null,
    jsPerMinute: js === undefined ? null : perMinute(js.count),
    processPerMinute: perMinute(woke.reduce((sum, thread) => sum + thread.count, 0)),
    top: woke
      .filter((thread) => thread.count > 0)
      .toSorted((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((thread) => ({ name: thread.name, perMinute: perMinute(thread.count) })),
  };
};

/** One measured step, as the results file keeps it. */
export interface StepRecord extends StepMetrics {
  readonly type: "step";
  readonly run: string;
  readonly scenario: string;
  readonly variant: string;
  /** What the step measures within its scenario ("tab", "push", "pop", "open"…). */
  readonly measure: string;
  readonly iteration: number;
  readonly index: number;
  /** A screen-off window's wake-ups (`screenOff` steps only). */
  readonly wakeups?: Wakeups | null;
}

export interface Distribution {
  readonly n: number;
  readonly median: number | null;
  readonly p90: number | null;
  readonly max: number | null;
}

const distribution = (values: readonly (number | null)[]): Distribution => {
  const sorted = values
    .filter((value): value is number => value !== null)
    .toSorted((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n, median: null, p90: null, max: null };
  const middle = Math.floor(n / 2);
  const median =
    n % 2 === 1 ? sorted[middle] : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return {
    n,
    median: round(median ?? 0),
    p90: sorted[Math.ceil(0.9 * n) - 1] ?? null,
    max: sorted[n - 1] ?? null,
  };
};

const histogramPercentile = (
  histogram: ReadonlyMap<number, number>,
  total: number,
  q: number,
): number | null => {
  if (total === 0) return null;
  const rank = Math.ceil(q * total);
  let seen = 0;
  for (const [ms, count] of [...histogram].toSorted((a, b) => a[0] - b[0])) {
    seen += count;
    if (seen >= rank) return ms;
  }
  return null;
};

/** The latency metrics a summary reports, in the order it reports them. */
const LATENCIES = ["firstFrameMs", "responseMs", "settleMs", "burstMs", "inputToJsMs"] as const;
type Latency = (typeof LATENCIES)[number];

export interface SummaryRow {
  /** `<scenario>/<variant>/<measure>`. */
  readonly key: string;
  readonly steps: number;
  readonly metrics: Readonly<Record<Latency, Distribution>>;
  readonly frames: {
    readonly total: number;
    readonly deadlineMissed: number;
    readonly missRate: number | null;
    readonly p50Ms: number | null;
    readonly p90Ms: number | null;
    readonly p99Ms: number | null;
  };
  /**
   * Each frame part's mean over every kept frame of the group's steps, and the
   * median of the steps' 90th percentiles.
   */
  readonly frameParts: Readonly<
    Record<
      Part,
      { readonly frames: number; readonly meanMs: number | null; readonly p90Ms: number | null }
    >
  >;
  readonly rendersPerStep: Readonly<Record<string, number>>;
  readonly longTasks: { readonly count: number; readonly totalMs: number };
  /** Steps whose expected mark never came. */
  readonly missing: number;
  /** Each phase the steps timed (`phasesMs`), from the touch. */
  readonly phases: Readonly<Record<string, Distribution>>;
  /** Wake-ups per minute, for steps that counted them (screen-off windows); null otherwise. */
  readonly wakeups: {
    readonly jsPerMinute: Distribution;
    readonly processPerMinute: Distribution;
  } | null;
}

/** [group]'s frame parts pooled; steps recorded before parts were measured count as none. */
const pooledParts = (group: readonly StepRecord[]): SummaryRow["frameParts"] =>
  Object.fromEntries(
    FRAME_PARTS.map((part) => {
      const stats = group.flatMap((step) => {
        const one = (step.frameParts as StepRecord["frameParts"] | undefined)?.[part];
        return one === undefined || one.frames === 0 ? [] : [one];
      });
      const frames = stats.reduce((sum, one) => sum + one.frames, 0);
      const total = stats.reduce((sum, one) => sum + (one.meanMs ?? 0) * one.frames, 0);
      return [
        part,
        {
          frames,
          meanMs: frames === 0 ? null : round(total / frames),
          p90Ms: distribution(stats.map((one) => one.p90Ms)).median,
        },
      ];
    }),
  ) as SummaryRow["frameParts"];

/** The run's steps summed up per scenario, variant and measure, in the order they first ran. */
export const summarize = (steps: readonly StepRecord[]): SummaryRow[] => {
  const groups = new Map<string, StepRecord[]>();
  for (const step of steps) {
    const key = `${step.scenario}/${step.variant}/${step.measure}`;
    groups.set(key, [...(groups.get(key) ?? []), step]);
  }
  return [...groups].map(([key, group]) => {
    const histogram = new Map<number, number>();
    const renders = new Map<string, number>();
    for (const step of group) {
      for (const [ms, count] of step.frames.histogram)
        histogram.set(ms, (histogram.get(ms) ?? 0) + count);
      for (const [component, count] of Object.entries(step.renders))
        renders.set(component, (renders.get(component) ?? 0) + count);
    }
    const binned = [...histogram.values()].reduce((sum, count) => sum + count, 0);
    const total = group.reduce((sum, step) => sum + step.frames.total, 0);
    const deadlineMissed = group.reduce((sum, step) => sum + step.frames.deadlineMissed, 0);
    return {
      key,
      steps: group.length,
      metrics: Object.fromEntries(
        LATENCIES.map((metric) => [metric, distribution(group.map((step) => step[metric]))]),
      ) as Record<Latency, Distribution>,
      frames: {
        total,
        deadlineMissed,
        missRate: total === 0 ? null : round(deadlineMissed / total),
        p50Ms: histogramPercentile(histogram, binned, 0.5),
        p90Ms: histogramPercentile(histogram, binned, 0.9),
        p99Ms: histogramPercentile(histogram, binned, 0.99),
      },
      frameParts: pooledParts(group),
      rendersPerStep: Object.fromEntries(
        [...renders].map(([component, count]) => [component, round(count / group.length)]),
      ),
      longTasks: {
        count: group.reduce((sum, step) => sum + step.longTasks.count, 0),
        totalMs: round(group.reduce((sum, step) => sum + step.longTasks.totalMs, 0)),
      },
      missing: group.filter((step) => step.expectMissing === true).length,
      phases: Object.fromEntries(
        [...new Set(group.flatMap((step) => Object.keys(step.phasesMs ?? {})))].map((phase) => [
          phase,
          distribution(
            group
              .filter((step) => step.phasesMs !== undefined)
              .map((step) => step.phasesMs?.[phase] ?? null),
          ),
        ]),
      ),
      wakeups: wakeupsOf(group),
    };
  });
};

const wakeupsOf = (group: readonly StepRecord[]): SummaryRow["wakeups"] => {
  const counted = group.flatMap((step) => {
    const wakeups = step.wakeups ?? null;
    return wakeups === null ? [] : [wakeups];
  });
  return counted.length === 0
    ? null
    : {
        jsPerMinute: distribution(counted.map((wakeups) => wakeups.jsPerMinute)),
        processPerMinute: distribution(counted.map((wakeups) => wakeups.processPerMinute)),
      };
};

/**
 * Wake-ups per minute (median / p90) per scenario step that counted them, as a
 * Markdown table. Empty when no step did.
 */
export const formatWakeups = (rows: readonly SummaryRow[]): string => {
  const lines = rows.flatMap(({ key, steps, wakeups }) =>
    wakeups === null
      ? []
      : [
          `| ${key} | ${steps} | ${pair(wakeups.jsPerMinute)} | ${pair(wakeups.processPerMinute)} |`,
        ],
  );
  return lines.length === 0
    ? ""
    : [
        "| Scenario step | Steps | JS wake-ups/min | Process wake-ups/min |",
        "| --- | ---: | ---: | ---: |",
        ...lines,
      ].join("\n");
};

/**
 * Each scenario step's phases as a Markdown table: median / p90 ms from the
 * touch, and how many steps saw the phase. Empty when no step timed a phase.
 */
export const formatPhases = (rows: readonly SummaryRow[]): string => {
  const lines = rows.flatMap((row) =>
    Object.entries(row.phases).map(
      ([phase, value]) => `| ${row.key} | ${phase} | ${pair(value)} | ${value.n} |`,
    ),
  );
  return lines.length === 0
    ? ""
    : [
        "| Scenario step | Phase | ms from the touch | Steps |",
        "| --- | --- | ---: | ---: |",
        ...lines,
      ].join("\n");
};

const pair = (value: Distribution): string =>
  value.median === null ? "-" : `${show(value.median)} / ${show(value.p90 ?? value.median)}`;

/**
 * [rows] as a Markdown table: latencies as median / p90 in ms, frames rendered,
 * the share that missed their deadline, and steps whose expected mark never came.
 */
export const formatSummary = (rows: readonly SummaryRow[]): string =>
  [
    "| Scenario step | Steps | Response ms | First frame ms | Settle ms | Burst ms | Frames | Late | Frame p90 ms | Long tasks | Missing |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      [
        row.key,
        row.steps,
        pair(row.metrics.responseMs),
        pair(row.metrics.firstFrameMs),
        pair(row.metrics.settleMs),
        pair(row.metrics.burstMs),
        row.frames.total,
        row.frames.missRate === null ? "-" : `${Math.round(row.frames.missRate * 100)}%`,
        row.frames.p90Ms ?? "-",
        row.longTasks.count,
        row.missing,
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .concat(" |"),
    ),
  ].join("\n");

const PART_HEADINGS: Readonly<Record<Part, string>> = {
  traversalMs: "Pre-draw and layout ms",
  drawMs: "Draw ms",
  syncMs: "Sync ms",
  issueMs: "Issue ms",
  gpuMs: "GPU after swap ms",
};

/**
 * [rows]' frame parts as a Markdown table: each part's mean / median step p90 in
 * ms over the kept frames. UI thread: pre-draw and layout, draw. RenderThread:
 * sync, issue. Then the GPU's time after the swap.
 */
export const formatFrameParts = (rows: readonly SummaryRow[]): string =>
  [
    `| Scenario step | Frames | ${FRAME_PARTS.map((part) => PART_HEADINGS[part]).join(" | ")} |`,
    `| --- | ---: |${FRAME_PARTS.map(() => " ---: |").join("")}`,
    ...rows.map(
      (row) =>
        `| ${row.key} | ${Math.max(...FRAME_PARTS.map((part) => row.frameParts[part].frames))} | ${FRAME_PARTS.map(
          (part) => {
            const { meanMs, p90Ms } = row.frameParts[part];
            return meanMs === null ? "-" : `${show(meanMs)} / ${show(p90Ms ?? meanMs)}`;
          },
        ).join(" | ")} |`,
    ),
  ].join("\n");

export interface ComparisonRow {
  readonly key: string;
  readonly metric: string;
  readonly before: number;
  readonly after: number;
  readonly change: number;
  readonly changePercent: number | null;
}

/** The values a comparison lines up for each scenario step. */
const comparable = (row: SummaryRow): [string, number | null][] => [
  ...LATENCIES.flatMap((metric): [string, number | null][] => [
    [`${metric} median`, row.metrics[metric].median],
    [`${metric} p90`, row.metrics[metric].p90],
  ]),
  ["frames p90 ms", row.frames.p90Ms],
  ["frames p99 ms", row.frames.p99Ms],
  ["deadline-miss rate", row.frames.missRate],
  ["long tasks", row.longTasks.count],
  ...FRAME_PARTS.flatMap((part): [string, number | null][] => [
    [`${part} mean`, row.frameParts[part].meanMs],
    [`${part} p90`, row.frameParts[part].p90Ms],
  ]),
  ...Object.entries(row.phases).flatMap(([phase, value]): [string, number | null][] => [
    [`${phase} median`, value.median],
    [`${phase} p90`, value.p90],
  ]),
  ["JS wake-ups/min median", row.wakeups?.jsPerMinute.median ?? null],
  ["process wake-ups/min median", row.wakeups?.processPerMinute.median ?? null],
  ...Object.entries(row.rendersPerStep).map(([component, count]): [string, number | null] => [
    `renders ${component}`,
    count,
  ]),
];

/** [before] and [after] side by side, for the scenario steps both ran. */
export const compareSummaries = (
  before: readonly SummaryRow[],
  after: readonly SummaryRow[],
): ComparisonRow[] =>
  before.flatMap((old) => {
    const now = after.find((row) => row.key === old.key);
    if (now === undefined) return [];
    const values = new Map(comparable(now));
    return comparable(old).flatMap(([metric, was]): ComparisonRow[] => {
      const is = values.get(metric);
      if (was === null || is === null || is === undefined) return [];
      return [
        {
          key: old.key,
          metric,
          before: was,
          after: is,
          change: round(is - was),
          changePercent: was === 0 ? null : Math.round(((is - was) / was) * 100),
        },
      ];
    });
  });

const show = (value: number): string => String(Math.round(value * 10) / 10);

/** [rows] as the Markdown table a ticket's performance doc pastes in. */
export const formatComparison = (rows: readonly ComparisonRow[]): string =>
  [
    "| Scenario step | Metric | Before | After | Change |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.metric} | ${show(row.before)} | ${show(row.after)} | ${show(row.change)}${
          row.changePercent === null
            ? ""
            : ` (${row.changePercent > 0 ? "+" : ""}${row.changePercent}%)`
        } |`,
    ),
  ].join("\n");
