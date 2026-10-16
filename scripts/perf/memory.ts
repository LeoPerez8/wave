// Whether memory, views, listeners or caches keep growing over a long run of the same cycle
// (#318: the soak scenarios). A scenario that reads memory over its iterations (`memorySamples`)
// gives a series per field; its steps give the app's own counters at the end of each cycle.
import type { Meminfo } from "./device.ts";
import type { MemoryRecord } from "./results.ts";

/** What a growth row counts in, which sets how much movement is noise. */
export type GrowthUnit = "KB" | "bytes" | "objects" | "exact";

export type GrowthVerdict = "still growing" | "levelled" | "flat" | "too few samples";

export interface GrowthRow {
  /** `<scenario>/<variant>`. */
  readonly key: string;
  /** The meminfo field (`totalPssKb`, `views`), `jsHeapUsed`, or an app counter (`listeners.playback`). */
  readonly measure: string;
  readonly unit: GrowthUnit;
  readonly samples: number;
  readonly first: number;
  readonly last: number;
  readonly change: number;
  /** What the second half of the samples added: growth that hasn't stopped shows here. */
  readonly lateChange: number;
  readonly verdict: GrowthVerdict;
}

/** The parts of a measured step the growth check reads. */
export interface GrowthStep {
  readonly scenario: string;
  readonly variant: string;
  readonly iteration: number;
  readonly index: number;
  readonly jsHeapUsed?: number;
  readonly listeners?: Readonly<Record<string, unknown>>;
  readonly libraryQueries?: Readonly<Record<string, unknown>>;
}

const MEMINFO_FIELDS: readonly [keyof Meminfo, GrowthUnit][] = [
  ["totalPssKb", "KB"],
  ["totalRssKb", "KB"],
  ["javaHeapKb", "KB"],
  ["nativeHeapKb", "KB"],
  ["graphicsKb", "KB"],
  ["privateOtherKb", "KB"],
  ["views", "objects"],
  ["viewRoots", "objects"],
  ["activities", "objects"],
  ["appContexts", "objects"],
  ["localBinders", "objects"],
  ["proxyBinders", "objects"],
  ["deathRecipients", "objects"],
];

/** The Library query registry's sizes (not its counters since launch, which only rise). */
const QUERY_SIZES = ["entries", "retained", "consumers"] as const;

/**
 * Movement within this is noise: memory moves with the garbage collector and
 * allocators, object counts with finalizers; the app's own counts are exact.
 */
const tolerance = (unit: GrowthUnit, first: number): number => {
  const share = Math.abs(first) * 0.02;
  switch (unit) {
    case "KB":
      return Math.max(1_024, share);
    case "bytes":
      return Math.max(1_048_576, share);
    case "objects":
      return Math.max(2, share);
    case "exact":
      return 0;
  }
};

const row = (
  key: string,
  measure: string,
  unit: GrowthUnit,
  series: readonly number[],
): GrowthRow | null => {
  const first = series[0];
  const last = series[series.length - 1];
  if (first === undefined || last === undefined || series.length < 2) return null;
  const middle = series[Math.floor((series.length - 1) / 2)] ?? first;
  const change = last - first;
  const lateChange = last - middle;
  const allowed = tolerance(unit, first);
  const verdict: GrowthVerdict =
    series.length < 3
      ? "too few samples"
      : lateChange > allowed
        ? "still growing"
        : change > allowed
          ? "levelled"
          : "flat";
  return { key, measure, unit, samples: series.length, first, last, change, lateChange, verdict };
};

const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
};

const numbers = (values: readonly unknown[]): number[] =>
  values.every((value) => typeof value === "number") ? (values as number[]) : [];

/**
 * A row per field that a soak scenario sampled, per scenario and variant:
 * retained memory and object counts from its memory samples, and Hermes's heap,
 * the playback stores' listeners and the Library query registry's sizes from
 * the last step of each cycle (the same screen each time). Scenarios that read
 * memory once are left out.
 */
export const memoryGrowth = (results: {
  readonly memory: readonly MemoryRecord[];
  readonly steps: readonly GrowthStep[];
}): GrowthRow[] => {
  const rows: (GrowthRow | null)[] = [];
  const sampled = results.memory.filter((record) => record.iteration !== undefined);
  for (const [key, records] of groupBy(
    sampled,
    (record) => `${record.scenario}/${record.variant}`,
  )) {
    const ordered = records.toSorted((a, b) => (a.iteration ?? 0) - (b.iteration ?? 0));
    for (const [field, unit] of MEMINFO_FIELDS)
      rows.push(row(key, field, unit, numbers(ordered.map((record) => record[field]))));
  }
  const soaked = new Set(sampled.map((record) => `${record.scenario}/${record.variant}`));
  const soakSteps = results.steps.filter((step) => soaked.has(`${step.scenario}/${step.variant}`));
  for (const [key, steps] of groupBy(soakSteps, (step) => `${step.scenario}/${step.variant}`)) {
    const cycleEnds = [...groupBy(steps, (step) => String(step.iteration)).values()]
      .map((cycle) => cycle.reduce((last, step) => (step.index > last.index ? step : last)))
      .toSorted((a, b) => a.iteration - b.iteration);
    rows.push(row(key, "jsHeapUsed", "bytes", numbers(cycleEnds.map((step) => step.jsHeapUsed))));
    const listenerNames = new Set(cycleEnds.flatMap((step) => Object.keys(step.listeners ?? {})));
    for (const name of listenerNames)
      rows.push(
        row(
          key,
          `listeners.${name}`,
          "exact",
          numbers(cycleEnds.map((step) => step.listeners?.[name])),
        ),
      );
    for (const name of QUERY_SIZES)
      rows.push(
        row(
          key,
          `libraryQueries.${name}`,
          "exact",
          numbers(cycleEnds.map((step) => step.libraryQueries?.[name])),
        ),
      );
  }
  const found = rows.filter((growth): growth is GrowthRow => growth !== null);
  // Each scenario's rows together: its memory first, then its counters.
  const order = [...new Set(found.map((growth) => growth.key))];
  return found.toSorted((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
};

export interface MemoryComparisonRow {
  /** `<scenario>/<variant>`. */
  readonly key: string;
  readonly measure: keyof Meminfo;
  readonly unit: GrowthUnit;
  readonly before: number | null;
  readonly after: number | null;
}

/** Each scenario's last memory reading: after all its iterations. */
const retainedAtEnd = (memory: readonly MemoryRecord[]): Map<string, MemoryRecord> => {
  const last = new Map<string, MemoryRecord>();
  for (const record of memory) {
    const key = `${record.scenario}/${record.variant}`;
    const known = last.get(key);
    if (known === undefined || (record.iteration ?? 0) >= (known.iteration ?? 0))
      last.set(key, record);
  }
  return last;
};

/**
 * Retained memory and object counts at the end of each scenario, [before] next
 * to [after], for the fields either side read. A scenario only one side ran
 * has the other side null.
 */
export const compareMemory = (
  before: readonly MemoryRecord[],
  after: readonly MemoryRecord[],
): MemoryComparisonRow[] => {
  const [was, now] = [retainedAtEnd(before), retainedAtEnd(after)];
  const keys = [...new Set([...was.keys(), ...now.keys()])];
  return keys.flatMap((key) =>
    MEMINFO_FIELDS.flatMap(([measure, unit]) => {
      const [then, later] = [was.get(key)?.[measure] ?? null, now.get(key)?.[measure] ?? null];
      return then === null && later === null
        ? []
        : [{ key, measure, unit, before: then, after: later }];
    }),
  );
};

export const formatMemoryComparison = (rows: readonly MemoryComparisonRow[]): string =>
  [
    "| Scenario | Measure | Before | After | Change |",
    "| --- | --- | ---: | ---: | ---: |",
    ...rows.map(
      (one) =>
        `| ${one.key} | ${one.measure} | ${one.before === null ? "-" : amount(one.unit, one.before)} | ${
          one.after === null ? "-" : amount(one.unit, one.after)
        } | ${
          one.before === null || one.after === null
            ? "-"
            : amount(one.unit, one.after - one.before, true)
        } |`,
    ),
  ].join("\n");

const amount = (unit: GrowthUnit, value: number, signed = false): string => {
  const sign = signed && value > 0 ? "+" : "";
  switch (unit) {
    case "KB":
      return `${sign}${(value / 1_024).toFixed(1)} MB`;
    case "bytes":
      return `${sign}${(value / 1_048_576).toFixed(1)} MB`;
    case "objects":
    case "exact":
      return `${sign}${value}`;
  }
};

export const formatGrowth = (rows: readonly GrowthRow[]): string =>
  [
    "| Scenario | Measure | Samples | First | Last | Change | Second half | Verdict |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map(
      (growth) =>
        `| ${growth.key} | ${growth.measure} | ${growth.samples} | ${amount(
          growth.unit,
          growth.first,
        )} | ${amount(growth.unit, growth.last)} | ${amount(
          growth.unit,
          growth.change,
          true,
        )} | ${amount(growth.unit, growth.lateChange, true)} | ${growth.verdict} |`,
    ),
  ].join("\n");
