// What one measured step's frames and perf log say (stepMetrics), how a run's steps
// sum up per scenario (summarize), and how two runs compare (compareSummaries).
// docs/performance/README.md defines each metric.
import type { PerfEntry, PerfFlush } from "../../packages/core/src/index.ts";
import type { GfxFrame, GfxSummary } from "./device.ts";

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
  readonly renders: Readonly<Record<string, number>>;
  readonly longTasks: { readonly count: number; readonly totalMs: number; readonly maxMs: number };
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
}): StepMetrics => {
  const entries = step.flush?.entries ?? [];
  const stepTouches = touches(entries);
  const touch = step.anchor === "last" ? stepTouches[stepTouches.length - 1] : stepTouches[0];
  const touchAt = touch?.eventAt ?? null;
  const burst = burstOf(step.frames, touchAt);
  const first = burst[0];
  const last = burst[burst.length - 1];
  const interval = first?.intervalMs ?? 16.7;
  // gfxinfo keeps 120 frames a window: when it rendered more, the earliest may be gone.
  const dropped = (step.summary.totalFrames ?? 0) > step.frames.length;
  const framesCovered =
    !dropped ||
    touchAt === null ||
    (first !== undefined && first.intendedVsyncMs <= touchAt + 2 * interval);
  const expected =
    step.expect === undefined || touchAt === null
      ? undefined
      : marks(entries).find(
          (mark) =>
            mark.at >= touchAt &&
            mark.name === step.expect?.mark &&
            (step.expect.detail === undefined || mark.detail === step.expect.detail),
        );
  const routes = marks(entries).filter((mark) => mark.name === "route");
  const longTasks = entries.filter(
    (entry): entry is Extract<PerfEntry, { kind: "longtask" }> => entry.kind === "longtask",
  );
  return {
    touchAt,
    inputToJsMs: touch === undefined ? null : round(touch.at - touch.eventAt),
    firstFrameMs: framesCovered ? sinceTouch(first?.completedMs ?? null, touchAt) : null,
    responseMs: sinceTouch(expected?.at ?? null, touchAt),
    settleMs: framesCovered ? sinceTouch(last?.completedMs ?? null, touchAt) : null,
    burstMs:
      first === undefined || last === undefined
        ? null
        : round(last.completedMs - first.intendedVsyncMs),
    expectMissing: step.expect === undefined || step.flush === null ? null : expected === undefined,
    framesCovered,
    finalRoute: routes[routes.length - 1]?.detail ?? null,
    frames: frameStats(step.summary, step.frames),
    renders: step.flush?.renders ?? {},
    longTasks: {
      count: longTasks.length,
      totalMs: round(longTasks.reduce((sum, task) => sum + task.duration, 0)),
      maxMs: longTasks.reduce((max, task) => Math.max(max, task.duration), 0),
    },
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
  readonly rendersPerStep: Readonly<Record<string, number>>;
  readonly longTasks: { readonly count: number; readonly totalMs: number };
  /** Steps whose expected mark never came. */
  readonly missing: number;
}

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
      rendersPerStep: Object.fromEntries(
        [...renders].map(([component, count]) => [component, round(count / group.length)]),
      ),
      longTasks: {
        count: group.reduce((sum, step) => sum + step.longTasks.count, 0),
        totalMs: round(group.reduce((sum, step) => sum + step.longTasks.totalMs, 0)),
      },
      missing: group.filter((step) => step.expectMissing === true).length,
    };
  });
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
