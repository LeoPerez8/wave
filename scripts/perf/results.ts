// The results file (docs/performance/README.md, "Results file"): JSON Lines, one record
// per line, written as the run goes so an interrupted run keeps what it measured.
import type { PerfMeta } from "../../packages/core/src/index.ts";
import type { AmStart, Meminfo } from "./device.ts";
import type { StepRecord } from "./metrics.ts";

/** The run's first record: what was measured, on what, with what. */
export interface RunRecord {
  readonly type: "run";
  readonly schema: 1;
  readonly run: string;
  readonly label: string;
  readonly startedAt: string;
  readonly dryRun: boolean;
  readonly runner: Readonly<Record<string, unknown>>;
  readonly apk: {
    readonly package: string;
    readonly versionName: string | null;
    readonly versionCode: number | null;
    readonly lastUpdateTime: string | null;
    readonly commit: string | null;
    readonly file: { readonly path: string; readonly sha256: string } | null;
  };
  readonly device: {
    readonly serial: string;
    readonly manufacturer: string | null;
    readonly model: string | null;
    readonly android: string | null;
    readonly sdk: number | null;
    readonly fingerprint: string | null;
  };
  readonly display: {
    readonly refreshRateHz: number | null;
    readonly peakRefreshRate: string | null;
    readonly minRefreshRate: string | null;
    readonly refreshRateMode: string | null;
  };
  readonly animationScales: Readonly<Record<string, string | null>>;
  readonly compilation: { readonly status: string; readonly reason: string | null } | null;
  readonly perfBuild: boolean;
  readonly library: Readonly<
    Record<
      "tracks" | "playlists" | "playlistItems" | "largestPlaylist" | "playEvents",
      number | null
    >
  >;
  readonly importLink: string | null;
  readonly app: PerfMeta | null;
  readonly thermalStatus: number | null;
  readonly manual: Readonly<Record<string, string>>;
}

export type MeasuredStep = StepRecord & {
  readonly flushComplete?: boolean | null;
  readonly launch?: AmStart;
  readonly appStartup?: Readonly<Record<string, number>>;
  readonly importProgress?: {
    readonly running: boolean;
    readonly done: unknown;
    readonly total: unknown;
    /** Progress notifications sent since launch (paced, #308). */
    readonly progressShown?: unknown;
  };
  /**
   * The shared Library queries' counters at the step's flush, since launch
   * (Core's `LibraryQueryStats`): reads, shared, paused, discarded, evicted,
   * entries, retained, consumers.
   */
  readonly libraryQueries?: Readonly<Record<string, unknown>>;
  /**
   * What playlist reads and edits cost since launch (#308,
   * `apps/mobile/src/library/db/playlistWork.ts`): `listReads`, `notifiedAll`,
   * and `decoded`, `summarized`, `pageReads`, `appends`, `notified`, each as
   * `.affected` (the playlists imports fill) and `.unrelated` (the others).
   */
  readonly playlistWork?: Readonly<Record<string, unknown>>;
};

export type MemoryRecord = Meminfo & {
  readonly type: "memory";
  readonly run: string;
  readonly scenario: string;
  readonly variant: string;
};

export interface ErrorRecord {
  readonly type: "error";
  readonly run: string;
  readonly scenario: string;
  readonly variant: string;
  readonly message: string;
}

export interface TraceRecord {
  readonly type: "trace";
  readonly run: string;
  readonly name: string;
  readonly file: string;
}

export interface EndRecord {
  readonly type: "end";
  readonly run: string;
  readonly finishedAt: string;
  readonly thermalStatus: number | null;
}

export interface Results {
  readonly run: RunRecord | null;
  readonly steps: MeasuredStep[];
  readonly memory: MemoryRecord[];
  readonly errors: ErrorRecord[];
  readonly traces: TraceRecord[];
  readonly end: EndRecord | null;
}

const differs = (label: string, before: unknown, after: unknown, unit = ""): string[] =>
  before === after ? [] : [`${label}: ${String(before)}${unit}, then ${String(after)}${unit}.`];

/** A Library count that moved by more than 1%. */
const grew = (label: string, before: number | null, after: number | null): string[] =>
  before === null || after === null || Math.abs(after - before) <= Math.max(1, before * 0.01)
    ? []
    : [`${label}: ${before}, then ${after}.`];

/**
 * What makes [before] and [after] not like for like: another phone, refresh rate,
 * compiler filter, animation scales, Library size, build kind. Empty when they compare.
 */
export const comparability = (before: RunRecord, after: RunRecord): string[] => [
  ...(before.device.model === after.device.model
    ? differs("Android build", before.device.fingerprint, after.device.fingerprint)
    : [`Different phones: ${before.device.model}, then ${after.device.model}.`]),
  ...differs("Refresh rate", before.display.refreshRateHz, after.display.refreshRateHz, " Hz"),
  ...differs("Motion smoothness", before.display.refreshRateMode, after.display.refreshRateMode),
  ...differs("Compiler filter", before.compilation?.status, after.compilation?.status),
  ...differs(
    "Animation scales",
    JSON.stringify(before.animationScales),
    JSON.stringify(after.animationScales),
  ),
  ...grew("Library songs", before.library.tracks, after.library.tracks),
  ...grew("Playlist entries", before.library.playlistItems, after.library.playlistItems),
  ...grew("Play history", before.library.playEvents, after.library.playEvents),
  ...differs("Perf build", before.perfBuild ? "yes" : "no", after.perfBuild ? "yes" : "no"),
  ...(before.dryRun || after.dryRun
    ? ["A dry run's numbers are simulated: don't compare them."]
    : []),
];

/** A results file's records by type. Several runs in one file read as the first run's metadata. */
export const readResults = (text: string): Results => {
  const results: Results = { run: null, steps: [], memory: [], errors: [], traces: [], end: null };
  let run: RunRecord | null = null;
  let end: EndRecord | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const record = JSON.parse(line) as { type: string };
    switch (record.type) {
      case "run":
        run ??= record as RunRecord;
        break;
      case "step":
        results.steps.push(record as MeasuredStep);
        break;
      case "memory":
        results.memory.push(record as MemoryRecord);
        break;
      case "error":
        results.errors.push(record as ErrorRecord);
        break;
      case "trace":
        results.traces.push(record as TraceRecord);
        break;
      case "end":
        end = record as EndRecord;
        break;
    }
  }
  return { ...results, run, end };
};
