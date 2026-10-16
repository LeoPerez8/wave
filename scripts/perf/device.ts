// Reads what adb and dumpsys print on the phone into the values the runner records
// (docs/performance/README.md). Each reader takes the command's whole output and is
// lenient: a field Android didn't print comes back null (or is left out), never invented.

/** gfxinfo's totals since its last reset (`dumpsys gfxinfo <package> reset`). */
export interface GfxSummary {
  readonly totalFrames: number | null;
  readonly jankyFrames: number | null;
  readonly p50Ms: number | null;
  readonly p90Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
  readonly missedVsync: number | null;
  readonly highInputLatency: number | null;
  readonly slowUiThread: number | null;
  readonly slowBitmapUploads: number | null;
  readonly slowIssueDrawCommands: number | null;
  readonly frameDeadlineMissed: number | null;
  /** CPU frame-time histogram: [bucket ms, frames]. */
  readonly histogram: readonly (readonly [number, number])[];
}

/** One frame gfxinfo kept (it keeps the last 120 per window). Times in ms, CLOCK_MONOTONIC. */
export interface GfxFrame {
  readonly window: string;
  /** Non-zero for frames Android flags as unusual (first draw, window change). */
  readonly flags: number;
  readonly inputEventId: number;
  readonly intendedVsyncMs: number;
  readonly completedMs: number;
  /** When the frame was due; null before Android 12. */
  readonly deadlineMs: number | null;
  readonly intervalMs: number | null;
}

const number = (text: string, pattern: RegExp): number | null => {
  const match = pattern.exec(text);
  return match?.[1] === undefined ? null : Number(match[1]);
};

const NS_PER_MS = 1_000_000;

const parseFrames = (text: string): GfxFrame[] => {
  const frames: GfxFrame[] = [];
  const blocks = text.split("---PROFILEDATA---");
  // Odd blocks hold the data; the block before each names its window on its last line.
  for (let i = 1; i < blocks.length; i += 2) {
    const before = (blocks[i - 1] ?? "").trimEnd().split(/\r?\n/);
    const window = (before[before.length - 1] ?? "").trim().replace(/\s*\(visibility=\d+\)$/, "");
    const lines = (blocks[i] ?? "").split(/\r?\n/).filter((line) => line.trim() !== "");
    const header = (lines[0] ?? "").split(",");
    const column = (name: string): number => header.indexOf(name);
    const [flags, input, intended, completed, deadline, interval] = [
      "Flags",
      "InputEventId",
      "IntendedVsync",
      "FrameCompleted",
      "FrameDeadline",
      "FrameInterval",
    ].map(column);
    if (intended === undefined || completed === undefined || intended < 0 || completed < 0)
      continue;
    for (const line of lines.slice(1)) {
      const cells = line.split(",").map(Number);
      const at = (index: number | undefined): number | null =>
        index === undefined || index < 0 || !Number.isFinite(cells[index])
          ? null
          : (cells[index] ?? null);
      const intendedNs = at(intended);
      const completedNs = at(completed);
      if (intendedNs === null || completedNs === null || completedNs === 0) continue;
      const deadlineNs = at(deadline);
      const intervalNs = at(interval);
      frames.push({
        window,
        flags: at(flags) ?? 0,
        inputEventId: at(input) ?? 0,
        intendedVsyncMs: intendedNs / NS_PER_MS,
        completedMs: completedNs / NS_PER_MS,
        deadlineMs: deadlineNs === null || deadlineNs === 0 ? null : deadlineNs / NS_PER_MS,
        intervalMs: intervalNs === null || intervalNs === 0 ? null : intervalNs / NS_PER_MS,
      });
    }
  }
  return frames;
};

/** `dumpsys gfxinfo <package> framestats`: the totals and the frames it kept. */
export const parseGfxinfo = (text: string): { summary: GfxSummary; frames: GfxFrame[] } => {
  const histogram = /^HISTOGRAM:(.*)$/m.exec(text)?.[1] ?? "";
  return {
    summary: {
      totalFrames: number(text, /^Total frames rendered: (\d+)/m),
      jankyFrames: number(text, /^Janky frames: (\d+)/m),
      p50Ms: number(text, /^50th percentile: (\d+)ms/m),
      p90Ms: number(text, /^90th percentile: (\d+)ms/m),
      p95Ms: number(text, /^95th percentile: (\d+)ms/m),
      p99Ms: number(text, /^99th percentile: (\d+)ms/m),
      missedVsync: number(text, /^Number Missed Vsync: (\d+)/m),
      highInputLatency: number(text, /^Number High input latency: (\d+)/m),
      slowUiThread: number(text, /^Number Slow UI thread: (\d+)/m),
      slowBitmapUploads: number(text, /^Number Slow bitmap uploads: (\d+)/m),
      slowIssueDrawCommands: number(text, /^Number Slow issue draw commands: (\d+)/m),
      frameDeadlineMissed: number(text, /^Number Frame deadline missed: (\d+)/m),
      histogram: [...histogram.matchAll(/(\d+)ms=(\d+)/g)].map(
        (match) => [Number(match[1]), Number(match[2])] as const,
      ),
    },
    frames: parseFrames(text),
  };
};

/** `dumpsys meminfo <package>`, in KB. Fields Android didn't print are left out. */
export interface Meminfo {
  readonly totalPssKb?: number;
  readonly totalRssKb?: number;
  readonly swapPssKb?: number;
  readonly javaHeapKb?: number;
  readonly nativeHeapKb?: number;
  readonly codeKb?: number;
  readonly stackKb?: number;
  readonly graphicsKb?: number;
  readonly privateOtherKb?: number;
  readonly systemKb?: number;
}

export const parseMeminfo = (text: string): Meminfo => {
  const summary = text.split(/^\s*App Summary\s*$/m)[1] ?? "";
  const fields: [keyof Meminfo, string, RegExp][] = [
    ["totalPssKb", text, /TOTAL PSS:\s+(\d+)/],
    ["totalRssKb", text, /TOTAL RSS:\s+(\d+)/],
    ["swapPssKb", text, /TOTAL SWAP PSS:\s+(\d+)/],
    ["javaHeapKb", summary, /^\s*Java Heap:\s+(\d+)/m],
    ["nativeHeapKb", summary, /^\s*Native Heap:\s+(\d+)/m],
    ["codeKb", summary, /^\s*Code:\s+(\d+)/m],
    ["stackKb", summary, /^\s*Stack:\s+(\d+)/m],
    ["graphicsKb", summary, /^\s*Graphics:\s+(\d+)/m],
    ["privateOtherKb", summary, /^\s*Private Other:\s+(\d+)/m],
    ["systemKb", summary, /^\s*System:\s+(\d+)/m],
  ];
  const meminfo: Record<string, number> = {};
  for (const [key, source, pattern] of fields) {
    const value = number(source, pattern);
    if (value !== null) meminfo[key] = value;
  }
  return meminfo;
};

/** `am start -W`: how the launch went. */
export interface AmStart {
  readonly status: string | null;
  readonly launchState: string | null;
  readonly totalTimeMs: number | null;
  readonly waitTimeMs: number | null;
}

export const parseAmStart = (text: string): AmStart => ({
  status: /^Status: (\S+)/m.exec(text)?.[1] ?? null,
  launchState: /^LaunchState: (\S+)/m.exec(text)?.[1] ?? null,
  totalTimeMs: number(text, /^TotalTime: (\d+)/m),
  waitTimeMs: number(text, /^WaitTime: (\d+)/m),
});

/** The installed APK, from `dumpsys package <package>`; null when it isn't installed. */
export const parsePackage = (
  text: string,
): {
  versionName: string | null;
  versionCode: number | null;
  lastUpdateTime: string | null;
} | null => {
  const versionCode = number(text, /versionCode=(\d+)/);
  if (versionCode === null) return null;
  return {
    versionName: /versionName=(\S+)/.exec(text)?.[1] ?? null,
    versionCode,
    lastUpdateTime: /lastUpdateTime=(.+)$/m.exec(text)?.[1]?.trim() ?? null,
  };
};

/** How ART compiled the APK (`speed-profile`, `verify`…), from `dumpsys package <package>`. */
export const parseCompilation = (
  text: string,
): { status: string; reason: string | null } | null => {
  const match = /\[status=([^\]]+)\](?:\s*\[reason=([^\]]+)\])?/.exec(text);
  return match?.[1] === undefined ? null : { status: match[1], reason: match[2] ?? null };
};

/** The display's refresh rate in Hz, from `dumpsys display`. */
export const parseRefreshRate = (text: string): number | null => {
  const rate =
    number(text, /mActiveSfDisplayMode=DisplayMode\{[^}]*refreshRate=([\d.]+)/) ??
    number(text, /mRefreshRate=([\d.]+)/);
  return rate === null ? null : Math.round(rate * 10) / 10;
};

/** `getprop`'s properties. */
export const parseGetprop = (text: string): Record<string, string> =>
  Object.fromEntries(
    [...text.matchAll(/^\[([^\]]+)\]: \[(.*)\]$/gm)].map((match) => [match[1], match[2] ?? ""]),
  );

/** The thermal status (0 none … 6 shutdown), from `dumpsys thermalservice`. */
export const parseThermalStatus = (text: string): number | null =>
  number(text, /^Thermal Status: (\d+)/m);

/** `wm density`: the density the screen is drawn at (dpi; 160 is one px per dp). */
export const parseDensity = (text: string): number | null =>
  number(text, /^Override density: (\d+)/m) ?? number(text, /^Physical density: (\d+)/m);

/** What the runner taps, found in a `uiautomator dump`. */
export type Target =
  { readonly desc: string } | { readonly descPrefix: string } | { readonly text: string };

const decode = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");

const attribute = (node: string, name: string): string | null => {
  const match = new RegExp(` ${name}="([^"]*)"`).exec(node);
  return match?.[1] === undefined ? null : decode(match[1]);
};

const matches = (node: string, target: Target): boolean => {
  if ("desc" in target) return attribute(node, "content-desc") === target.desc;
  if ("descPrefix" in target)
    return attribute(node, "content-desc")?.startsWith(target.descPrefix) ?? false;
  return attribute(node, "text") === target.text;
};

/** The centre of the first node in [xml] (a `uiautomator dump`) that [target] names. */
export const findNode = (xml: string, target: Target): { x: number; y: number } | null => {
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const node = match[0];
    if (!matches(node, target)) continue;
    const bounds = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(node);
    if (bounds === null) continue;
    const [left, top, right, bottom] = bounds.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
  }
  return null;
};
