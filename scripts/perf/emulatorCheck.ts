// The emulator check (#1359, docs/agents/emulator-checks.md): reads the app log the
// reference scenario left and fails on a JS block over 50 ms while a screen was shown, or
// on a tap kind whose first-frame p90 passed its budget by more than the emulator's noise.
import { JS_BLOCK_MS, TIMING_BUDGETS, type TimingKind } from "../../packages/core/src/index.ts";
import type { Device } from "./runner.ts";

/**
 * The name "Speed since" prints for each tap kind (Core's timing.ts). Typed by every kind,
 * so a new one fails the typecheck until it's named here.
 */
export const TAP_KIND_NAMES: Readonly<Record<TimingKind, string>> = {
  tab: "tab",
  push: "push",
  pop: "pop",
  nowPlayingOpen: "Now Playing open",
  nowPlayingClose: "Now Playing close",
  queue: "Queue",
  relatedOpen: "Related open",
  relatedClose: "Related close",
  artistLink: "artist link",
  albumLink: "album link",
  goToArtist: "Go to Artist",
  choiceCard: "choice card",
};

/**
 * How far past its budget a tap kind's p90 may go on the emulator before the check fails.
 * The x86_64 AVD on the development PC isn't the reference phone: its first frames swing
 * with the host's load, so the check catches regressions, not a few ms of noise.
 */
export const DEFAULT_NOISE_MS = 25;

export interface TapKindP90 {
  readonly kind: TimingKind;
  readonly taps: number;
  /** Null when no tap of the kind had its first frame measured. */
  readonly p90Ms: number | null;
  /** Null for a kind with no first-frame budget. */
  readonly budgetMs: number | null;
  /** Past its budget by more than the noise. */
  readonly over: boolean;
}

export interface JsBlock {
  /** The log entry's ISO time. */
  readonly at: string;
  readonly durationMs: number;
  readonly screen: string;
  readonly work: string;
}

export interface Verdict {
  readonly ok: boolean;
  readonly blocks: readonly JsBlock[];
  /** Each tap kind the summaries name, in their order; a kind in several summaries, once each. */
  readonly kinds: readonly TapKindP90[];
  /** One line per reason the check fails. */
  readonly failures: readonly string[];
}

export interface CheckOptions {
  /** Entries before this ISO time belong to earlier use and are skipped. */
  readonly since: string;
  /** How far past its budget a tap kind's p90 may go on the emulator. */
  readonly noiseMs: number;
}

/** An app log entry: `<ISO time> <level letter> <tag>: <message>` (Core's `formatLogEntry`). */
const ENTRY = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) [A-Z] ([^:]+): (.*)$/;

/** `timingDuration`'s text: whole milliseconds, or seconds with one decimal. */
const DURATION = String.raw`(\d+(?:\.\d+)?) (ms|s)`;
const durationMs = (value: string, unit: string): number =>
  unit === "s" ? Math.round(Number(value) * 1000) : Number(value);

const BLOCK = new RegExp(`^JS blocked ${DURATION} on (.+?) by (.+)$`);

const SUMMARY = "Speed since ";

/** One kind's part of a summary: `push 12 first frame (3 measured) median 41 ms p90 70 ms, …`. */
const KIND_PART = new RegExp(
  String.raw`^(.+?) (\d+) (?:first frame(?: \(\d+ measured\))? median ${DURATION} p90 ${DURATION})?`,
);

const KIND_BY_NAME = new Map(
  (Object.entries(TAP_KIND_NAMES) as [TimingKind, string][]).map(([kind, name]) => [name, kind]),
);

const firstFrameBudget = (kind: TimingKind): number | null => {
  const budget = TIMING_BUDGETS[kind];
  return "firstFrameMs" in budget ? budget.firstFrameMs : null;
};

const summaryKinds = (message: string, noiseMs: number): TapKindP90[] =>
  // The first part is the header ("Speed since … : N taps"), the last the slow/lost count.
  message.split("; ").flatMap((part) => {
    const match = KIND_PART.exec(part);
    const kind = match === null ? undefined : KIND_BY_NAME.get(match[1]!);
    if (match === null || kind === undefined) return [];
    const p90Ms = match[5] === undefined ? null : durationMs(match[5], match[6]!);
    const budgetMs = firstFrameBudget(kind);
    return [
      {
        kind,
        taps: Number(match[2]),
        p90Ms,
        budgetMs,
        over: p90Ms !== null && budgetMs !== null && p90Ms > budgetMs + noiseMs,
      },
    ];
  });

interface Entry {
  readonly at: string;
  readonly tag: string;
  readonly message: string;
}

const entries = (text: string, since: string): Entry[] =>
  text.split(/\r?\n/).flatMap((raw) => {
    const match = ENTRY.exec(raw);
    if (match === null || match[1]! < since) return [];
    return [{ at: match[1]!, tag: match[2]!, message: match[3]! }];
  });

export const checkLog = (text: string, options: CheckOptions): Verdict => {
  const blocks: JsBlock[] = [];
  const kinds: TapKindP90[] = [];
  let summaries = 0;
  for (const entry of entries(text, options.since)) {
    if (entry.message.startsWith(SUMMARY)) {
      summaries++;
      kinds.push(...summaryKinds(entry.message, options.noiseMs));
      continue;
    }
    const block = BLOCK.exec(entry.message);
    if (block === null) continue;
    const ms = durationMs(block[1]!, block[2]!);
    if (ms > JS_BLOCK_MS)
      blocks.push({ at: entry.at, durationMs: ms, screen: block[3]!, work: block[4]! });
  }
  const failures = [
    ...blocks.map(
      (block) => `JS blocked ${block.durationMs} ms on ${block.screen} by ${block.work}`,
    ),
    ...kinds
      .filter((kind) => kind.over)
      .map(
        (kind) =>
          `${TAP_KIND_NAMES[kind.kind]}: first-frame p90 ${kind.p90Ms} ms, past its ${kind.budgetMs} ms budget by more than ${options.noiseMs} ms`,
      ),
    ...(summaries === 0
      ? ['The app log has no "Speed since" summary since the run began: no tap was timed.']
      : []),
  ];
  return { ok: failures.length === 0, blocks, kinds, failures };
};

// ---------------------------------------------------------------------------
// On the emulator

export interface EmulatorCheckOptions {
  readonly package: string;
  readonly noiseMs: number;
  /** Plays the reference scenario (the perf runner's `reference-taps`). */
  readonly runScenario: () => Promise<void>;
  /** How long to wait for the summary once Wave has left the screen. */
  readonly summaryWaitMs?: number;
}

export interface EmulatorCheckResult {
  /** The AVD's name, or null on a phone. */
  readonly avd: string | null;
  /** The device's clock when the check began: log entries from then on are judged. */
  readonly since: string;
  readonly verdict: Verdict;
}

const POLL_MS = 1_000;

/**
 * Wave's app log (`files/logs/wave.log`): the emulator's root reads any build's, and
 * `run-as` a debuggable build's. Empty when neither can.
 */
const readAppLog = async (device: Device, pkg: string): Promise<string> => {
  const rooted = await device.shell(`su 0 cat /data/data/${pkg}/files/logs/wave.log`);
  if (ENTRY_START.test(rooted)) return rooted;
  const debuggable = await device.shell(`run-as ${pkg} cat files/logs/wave.log`);
  return ENTRY_START.test(debuggable) ? debuggable : "";
};

const ENTRY_START = /^\d{4}-\d\d-\d\dT/m;

const hasSummary = (text: string, since: string): boolean =>
  entries(text, since).some((entry) => entry.message.startsWith(SUMMARY));

export const runEmulatorCheck = async (
  device: Device,
  options: EmulatorCheckOptions,
): Promise<EmulatorCheckResult> => {
  // The app log stamps entries with the device's clock, so the start comes from it too.
  const since = (await device.shell("date -u +%Y-%m-%dT%H:%M:%S.000Z")).trim();
  const avd = (await device.shell("getprop ro.boot.qemu.avd_name")).trim() || null;
  await options.runScenario();
  // Leaving the screen is when the timing session writes its "Speed since" summary,
  // and the log writes what's waiting a moment later.
  await device.shell("input keyevent 3");
  let text = "";
  for (let waited = 0; waited <= (options.summaryWaitMs ?? 20_000); waited += POLL_MS) {
    text = await readAppLog(device, options.package);
    if (hasSummary(text, since)) break;
    await device.sleep(POLL_MS);
  }
  return { avd, since, verdict: checkLog(text, { since, noiseMs: options.noiseMs }) };
};

/** Every tap kind's first-frame p90 against its budget, every block, then the verdict. */
export const formatVerdict = (verdict: Verdict, noiseMs: number): string => {
  const rows = verdict.kinds.map((kind) =>
    [
      TAP_KIND_NAMES[kind.kind].padEnd(18),
      `${kind.taps} taps`.padEnd(9),
      (kind.p90Ms === null ? "p90 -" : `p90 ${kind.p90Ms} ms`).padEnd(13),
      (kind.budgetMs === null
        ? "no first-frame budget"
        : `budget ${kind.budgetMs} ms (+${noiseMs} ms noise)`
      ).padEnd(30),
      kind.over ? "OVER" : "ok",
    ].join(" "),
  );
  const blocks = verdict.blocks.map(
    (block) => `  ${block.at}  ${block.durationMs} ms on ${block.screen} by ${block.work}`,
  );
  return [
    "First frame by tap kind:",
    ...(rows.length === 0 ? ["  (none timed)"] : rows.map((row) => `  ${row}`)),
    "",
    `JS blocks over ${JS_BLOCK_MS} ms while a screen was shown: ${verdict.blocks.length}`,
    ...blocks,
    "",
    verdict.ok
      ? "PASS"
      : `FAIL\n${verdict.failures.map((failure) => `  ${failure}`).join("\n")}`,
  ].join("\n");
};
