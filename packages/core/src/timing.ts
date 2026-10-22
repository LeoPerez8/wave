/** Every build's navigation timing rules and app-log text. No platform work lives here. */
export const TIMING_BUDGETS = {
  tab: { responseMs: 100, firstFrameMs: 150 },
  push: { responseMs: 100, firstFrameMs: 150 },
  pop: { responseMs: 100, firstFrameMs: 150 },
  nowPlayingOpen: { responseMs: 50 },
  nowPlayingClose: { responseMs: 50 },
  queue: { responseMs: 100, firstFrameMs: 100 },
  artistLink: { firstFrameMs: 200 },
  albumLink: { firstFrameMs: 200 },
  goToArtist: { firstFrameMs: 200 },
  choiceCard: { responseMs: 100 },
  screen: { firstFrameMs: 150, contentMs: 400 },
  readMs: 16,
  lateFrameFactor: 1.5,
  hitchMs: 500,
  freezeMs: 3000,
  summaryIntervalMs: 5 * 60_000,
} as const;

export type TimingKind =
  | "tab"
  | "push"
  | "pop"
  | "nowPlayingOpen"
  | "nowPlayingClose"
  | "queue"
  | "artistLink"
  | "albumLink"
  | "goToArtist"
  | "choiceCard";

/** Known milestones of a gesture; a superseded gesture can have only its response. */
export interface TimingMeasurements {
  readonly kind: TimingKind;
  readonly responseMs?: number;
  readonly firstFrameMs?: number;
}

export interface TimingTap {
  readonly kind: TimingKind;
  readonly from: string;
  readonly to: string;
  readonly responseMs: number;
  readonly firstFrameMs: number;
  readonly settledMs: number;
  readonly background?: readonly string[];
  readonly offline?: boolean;
  readonly longestJsBlockMs?: number;
}

export interface TimingScreen {
  readonly route: string;
  readonly firstFrameMs: number;
  readonly contentMs: number;
  readonly reads?: readonly { readonly operation: string; readonly durationMs: number }[];
  readonly missedFrames?: number;
}

export interface TimingWindow {
  readonly since: number;
  readonly version: string;
  readonly commit: string;
  readonly taps: readonly TimingTap[];
  /** All gestures, including those superseded before all milestones could be observed. */
  readonly measurements?: readonly TimingMeasurements[];
  readonly screens: readonly TimingScreen[];
  readonly lostTaps?: number;
  readonly hitches?: readonly number[];
}

/** Same units as the log's waits: whole milliseconds, then seconds with one decimal. */
export const timingDuration = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(Math.round(ms / 100) / 10).toFixed(1)} s`;

const KIND_NAMES: Readonly<Record<TimingKind, string>> = {
  tab: "tab",
  push: "push",
  pop: "pop",
  nowPlayingOpen: "Now Playing open",
  nowPlayingClose: "Now Playing close",
  queue: "Queue",
  artistLink: "artist link",
  albumLink: "album link",
  goToArtist: "Go to Artist",
  choiceCard: "choice card",
};

/** At the budget is on time; settling itself has no budget. */
export const timingBudgetExceeded = (tap: TimingMeasurements): boolean => {
  const budget = TIMING_BUDGETS[tap.kind];
  return (
    ("responseMs" in budget &&
      tap.responseMs !== undefined &&
      tap.responseMs > budget.responseMs) ||
    ("firstFrameMs" in budget &&
      tap.firstFrameMs !== undefined &&
      tap.firstFrameMs > budget.firstFrameMs)
  );
};

export const slowTapLine = (tap: TimingTap): string | null => {
  if (!timingBudgetExceeded(tap)) return null;
  const budget = TIMING_BUDGETS[tap.kind];
  const limits = [
    "responseMs" in budget ? `${budget.responseMs} ms response` : null,
    "firstFrameMs" in budget ? `${budget.firstFrameMs} ms first frame` : null,
  ]
    .filter((value) => value !== null)
    .join(" / ");
  const context = [
    `meanwhile: ${tap.background?.length ? tap.background.join(", ") : "none"}`,
    ...(tap.offline ? ["offline"] : []),
    `longest JS block ${timingDuration(tap.longestJsBlockMs ?? 0)}`,
  ].join("; ");
  return `Slow ${KIND_NAMES[tap.kind]} to ${tap.to} from ${tap.from}: response ${timingDuration(tap.responseMs)}, first frame ${timingDuration(tap.firstFrameMs)}, settled ${timingDuration(tap.settledMs)} (budget ${limits}); ${context}`;
};

export const slowScreenLine = (screen: TimingScreen): string | null => {
  const budget = TIMING_BUDGETS.screen;
  if (screen.firstFrameMs <= budget.firstFrameMs && screen.contentMs <= budget.contentMs)
    return null;
  const reads = screen.reads?.length
    ? screen.reads.map((read) => `${read.operation} ${timingDuration(read.durationMs)}`).join(", ")
    : "none";
  return `Slow screen ${screen.route}: first frame ${timingDuration(screen.firstFrameMs)}, content ${timingDuration(screen.contentMs)} (budget ${budget.firstFrameMs} ms / ${budget.contentMs} ms); reads: ${reads}`;
};

/** Median averages the two middle values; p90 uses nearest rank (including one sample). */
const distribution = (values: readonly number[]): string => {
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return `median ${timingDuration(median)} p90 ${timingDuration(sorted[Math.ceil(sorted.length * 0.9) - 1]!)}`;
};

/** No summary without taps, even when a screen or a hitch was recorded. */
export const speedSummaryLine = (window: TimingWindow): string | null => {
  const measurements = window.measurements ?? window.taps;
  const total = measurements.length;
  if (total === 0) return null;
  const start = new Date(window.since);
  const since = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  const parts = [`Speed since ${since} (Wave ${window.version} @ ${window.commit}): ${total} taps`];
  for (const kind of Object.keys(KIND_NAMES) as TimingKind[]) {
    const taps = measurements.filter((tap) => tap.kind === kind);
    const responses = taps.flatMap((tap) => (tap.responseMs === undefined ? [] : [tap.responseMs]));
    if (taps.length > 0) {
      const measured =
        responses.length === taps.length ? "" : ` (${responses.length} responses measured)`;
      parts.push(
        responses.length === 0
          ? `${KIND_NAMES[kind]} ${taps.length} response not observed`
          : `${KIND_NAMES[kind]} ${taps.length}${measured} ${distribution(responses)}`,
      );
    }
  }
  const screens = new Map<string, TimingScreen[]>();
  for (const screen of window.screens) {
    const group = screens.get(screen.route) ?? [];
    group.push(screen);
    screens.set(screen.route, group);
  }
  for (const [route, samples] of screens) {
    parts.push(
      `screen ${route} content ${distribution(samples.map((screen) => screen.contentMs))}, missed frames ${samples.reduce((sum, screen) => sum + (screen.missedFrames ?? 0), 0)}`,
    );
  }
  const hitches = window.hitches ?? [];
  parts.push(
    `slow ${measurements.filter(timingBudgetExceeded).length}, lost ${window.lostTaps ?? 0}, hitches ${hitches.length} (longest ${timingDuration(hitches.reduce((max, ms) => Math.max(max, ms), 0))})`,
  );
  return parts.join("; ");
};

/** Count late callbacks, not inferred display slots. The interval comes from the display. */
export const lateFrame = (gapMs: number, intervalMs: number): boolean =>
  Number.isFinite(gapMs) &&
  Number.isFinite(intervalMs) &&
  intervalMs > 0 &&
  gapMs > TIMING_BUDGETS.lateFrameFactor * intervalMs;

/** Native FreezeWatch keeps this shape and these thresholds in step. */
export const hitchLine = (
  thread: "JS" | "main",
  durationMs: number,
  route?: string,
  stack?: string,
): string | null => {
  if (
    !Number.isFinite(durationMs) ||
    durationMs < TIMING_BUDGETS.hitchMs ||
    durationMs >= TIMING_BUDGETS.freezeMs
  )
    return null;
  return `${thread} thread busy ${(Math.round(durationMs / 100) / 10).toFixed(1)} s${route ? ` on ${route}` : ""}${stack ? `\n${stack}` : ""}`;
};

export interface TimingFrames {
  readonly count: number;
  readonly longestGapMs: number;
}

export const missedFramesLine = (
  transition: { readonly kind: TimingKind; readonly to: string },
  lane: "JS" | "UI",
  frames: TimingFrames,
): string | null => {
  if (frames.count <= 0) return null;
  const name = KIND_NAMES[transition.kind];
  return `${name[0]!.toUpperCase()}${name.slice(1)} to ${transition.to} missed ${frames.count} frames (longest gap ${timingDuration(frames.longestGapMs)}; ${lane})`;
};
