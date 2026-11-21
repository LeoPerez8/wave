/**
 * The app log's line for a JS block over 50 ms while a screen is shown
 * (#1350, #1359), naming the work that held the thread: the slice the block
 * ran in, else the named work still running then (begun and not ended, or
 * a free turn's work shortly after its turn), else "startup" before the
 * first screen settled, else none.
 */
import { timingDuration } from "./timing.ts";

/** A block longer than this, with a screen shown, is a bug to file. */
export const JS_BLOCK_MS = 50;

/** How many recent slices and works a long task may be matched against. */
const KEPT = 16;

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

export const createJsBlockLog = ({ write, screen }: JsBlockLogPorts): JsBlockLog => {
  const slices: Span[] = [];
  const works: Span[] = [];
  let settledAt: number | null = null;
  const log = (durationMs: number, work: string | null): boolean => {
    const shown = screen();
    if (shown === null) return false;
    write(jsBlockLine({ durationMs, screen: shown, work }));
    return true;
  };
  const keep = (list: Span[], span: Span): void => {
    list.push(span);
    if (list.length > KEPT) list.shift();
  };
  /** The latest-begun span of [list] overlapping [from, to]. */
  const latestWithin = (list: readonly Span[], from: number, to: number): Span | undefined => {
    let found: Span | undefined;
    for (const span of list)
      if (span.from <= to && span.to >= from && (found === undefined || span.from >= found.from))
        found = span;
    return found;
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
    firstSettled: (at) => {
      settledAt ??= at;
    },
    longTask: (startTime, durationMs) => {
      if (durationMs <= JS_BLOCK_MS) return;
      const end = startTime + durationMs;
      // A slice inside the task beats the work running around it.
      const slice = latestWithin(slices, startTime, end);
      if (slice?.logged === true) return;
      const name =
        slice?.name ??
        latestWithin(works, startTime, end)?.name ??
        (settledAt === null || startTime < settledAt ? STARTUP : null);
      log(durationMs, name);
    },
  };
};
