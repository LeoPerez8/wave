/**
 * The app log's line for a JS block over 50 ms while a screen is shown
 * (#1350, #1359), naming the work that held the thread: the slice the block
 * ran in, else the named work still running then (begun and not ended, or
 * a free turn's work shortly after its turn), else "startup" before the
 * first screen settled, with the startup step under way (#1434), else none. A screen or section rendering in the
 * block (#1423) names it as "rendering <name>" when it held more of the
 * block than any slice did, and beats running work.
 */
import { timingDuration } from "./timing.ts";

/** A block longer than this, with a screen shown, is a bug to file. */
export const JS_BLOCK_MS = 50;

/** How many recent slices and works a long task may be matched against. */
const KEPT = 16;

/** How many recent render spans: one commit can end several screens' and sections' renders. */
const KEPT_RENDERS = 32;

/**
 * How long after its free turn a work counts as still running when it never says it ended: its
 * awaited reads answer within this, and a later block is no longer its.
 */
export const TURN_WORK_MS = 1000;

export interface JsBlockLogPorts {
  readonly write: (line: string) => void;
  /** The screen shown, or null while none is (Wave in the background). */
  readonly screen: () => string | null;
}

export interface JsBlockLog {
  /** A background slice ran: whose, when it began and how long it held the thread. */
  readonly sliceRan: (name: string, startedAt: number, durationMs: number) => void;
  /**
   * The scheduler gave [name] a free turn at [at]: what runs on it, and its awaited
   * continuations, count as [name]'s work for `TURN_WORK_MS`, or until its next turn.
   */
  readonly turnTaken: (name: string, at: number) => void;
  /** [name]'s work began at [at]; the returned call says when it ended. */
  readonly workBegan: (name: string, at: number) => (endedAt: number) => void;
  /**
   * A screen or section named [name] rendered from [startedAt] until its commit's layout
   * effects, [durationMs] later (`useRenderCost` in the app). It writes nothing by itself: a
   * span may cover a yield, so only a long task the runtime reports says the thread was held.
   */
  readonly renderRan: (name: string, startedAt: number, durationMs: number) => void;
  /**
   * Startup reached [name] at [at] (#1434): a block before the first screen settles with no named
   * work says the latest step begun before it ended, as "startup (<name>)".
   */
  readonly startupStep: (name: string, at: number) => void;
  /** The first screen settled at [at]: blocks before it with no named work are startup's. */
  readonly firstSettled: (at: number) => void;
  /** The runtime reported a long task (`PerformanceObserver`'s "longtask"), on the same clock. */
  readonly longTask: (startTime: number, durationMs: number) => void;
}

/** What a block is put down to with no named work, before the first screen settled. */
const STARTUP = "startup";

// not UI text: the app log's line
export const jsBlockLine = (block: {
  readonly durationMs: number;
  readonly screen: string;
  readonly work: string | null;
}): string =>
  `JS blocked ${timingDuration(block.durationMs)} on ${block.screen} by ${block.work ?? "no background work"}`;

interface Span {
  readonly name: string;
  readonly from: number;
  to: number;
  readonly logged: boolean;
}

/** The part of [span] inside [from, to]. */
const overlap = (span: Span, from: number, to: number): number =>
  Math.max(0, Math.min(span.to, to) - Math.max(span.from, from));

/**
 * Of the render spans overlapping [from, to], the one to name and how much of the block the
 * renders held: the innermost span holding at least half of what the outermost one held, so a
 * section that took most of its screen's render names it, and a screen spread over its sections
 * names the screen.
 */
const renderWithin = (
  renders: readonly Span[],
  from: number,
  to: number,
): { readonly name: string; readonly held: number } | undefined => {
  const overlapping = renders.filter((span) => overlap(span, from, to) > 0);
  if (overlapping.length === 0) return undefined;
  const held = Math.max(...overlapping.map((span) => overlap(span, from, to)));
  let named: Span | undefined;
  for (const span of overlapping) {
    const part = overlap(span, from, to);
    if (part * 2 >= held && (named === undefined || part < overlap(named, from, to))) named = span;
  }
  return { name: named!.name, held };
};

export const createJsBlockLog = ({ write, screen }: JsBlockLogPorts): JsBlockLog => {
  const slices: Span[] = [];
  const renders: Span[] = [];
  const works: Span[] = [];
  const steps: { readonly name: string; readonly at: number }[] = [];
  let settledAt: number | null = null;
  const log = (durationMs: number, work: string | null): boolean => {
    const shown = screen();
    if (shown === null) return false;
    write(jsBlockLine({ durationMs, screen: shown, work }));
    return true;
  };
  const keep = (list: Span[], span: Span, kept = KEPT): void => {
    list.push(span);
    if (list.length > kept) list.shift();
  };
  /** The latest-begun span of [list] overlapping [from, to]. */
  const latestWithin = (list: readonly Span[], from: number, to: number): Span | undefined => {
    let found: Span | undefined;
    for (const span of list)
      if (span.from <= to && span.to >= from && (found === undefined || span.from >= found.from))
        found = span;
    return found;
  };
  /** Startup's name for a block ending at [end]: with the latest step begun before it. */
  const startup = (end: number): string => {
    let step: string | undefined;
    for (const { name, at } of steps) if (at < end) step = name;
    return step === undefined ? STARTUP : `${STARTUP} (${step})`;
  };
  return {
    sliceRan: (name, startedAt, durationMs) => {
      const logged = durationMs > JS_BLOCK_MS && log(durationMs, name);
      keep(slices, { name, from: startedAt, to: startedAt + durationMs, logged });
    },
    turnTaken: (name, at) => {
      // The same work's previous turn ended where this one begins.
      for (const work of works) if (work.name === name && work.to > at) work.to = at;
      keep(works, { name, from: at, to: at + TURN_WORK_MS, logged: false });
    },
    workBegan: (name, at) => {
      const work: Span = { name, from: at, to: Number.POSITIVE_INFINITY, logged: false };
      keep(works, work);
      return (endedAt) => {
        work.to = endedAt;
      };
    },
    renderRan: (name, startedAt, durationMs) => {
      keep(
        renders,
        { name, from: startedAt, to: startedAt + durationMs, logged: false },
        KEPT_RENDERS,
      );
    },
    startupStep: (name, at) => {
      if (settledAt === null && steps.length < KEPT) steps.push({ name, at });
    },
    firstSettled: (at) => {
      settledAt ??= at;
    },
    longTask: (startTime, durationMs) => {
      if (durationMs <= JS_BLOCK_MS) return;
      const end = startTime + durationMs;
      // A slice inside the task beats the work running around it.
      const slice = latestWithin(slices, startTime, end);
      if (slice?.logged === true) return;
      const render = renderWithin(renders, startTime, end);
      const rendering =
        render !== undefined &&
        (slice === undefined || render.held > overlap(slice, startTime, end))
          ? `rendering ${render.name}`
          : undefined;
      const name =
        rendering ??
        slice?.name ??
        latestWithin(works, startTime, end)?.name ??
        (settledAt === null || startTime < settledAt ? startup(end) : null);
      log(durationMs, name);
    },
  };
};
