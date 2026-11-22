/**
 * The app log's line for a JS block over 50 ms while a screen is shown
 * (#1350, #1359), naming the work that held the thread: the slice the block
 * ran in, else the named work still running then (begun and not ended, or
 * a free turn's work shortly after its turn), else "startup" before the
 * first screen settled, else none. A screen or section rendering in the
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

/**
 * Whether [span] touches the block [from, to], ends included, so a slice too short for the clock
 * to time still counts. Every match below uses this one rule.
 */
const within = (span: Span, from: number, to: number): boolean =>
  span.from <= to && span.to >= from;

/** The part of [span] inside [from, to]. */
const overlap = (span: Span, from: number, to: number): number =>
  Math.max(0, Math.min(span.to, to) - Math.max(span.from, from));

/** The latest-begun span of [list] within [from, to]. */
const latestWithin = (list: readonly Span[], from: number, to: number): Span | undefined => {
  let found: Span | undefined;
  for (const span of list)
    if (within(span, from, to) && (found === undefined || span.from >= found.from)) found = span;
  return found;
};

/** The span of [list] that held most of [from, to]; of equal ones, the latest begun. */
const mostWithin = (list: readonly Span[], from: number, to: number): Span | undefined => {
  let found: Span | undefined;
  for (const span of list) {
    if (!within(span, from, to)) continue;
    const part = overlap(span, from, to);
    const best = found === undefined ? -1 : overlap(found, from, to);
    if (part > best || (part === best && span.from >= found!.from)) found = span;
  }
  return found;
};

/**
 * Of the render spans within [from, to], the one to name and how much of the block the renders
 * held: the span that held most of it, or the innermost span inside that one holding at least
 * half as much, so a section that took most of its screen's render names it, a screen spread
 * over its sections names the screen, and a sibling never names it for its smaller share.
 */
const renderWithin = (
  renders: readonly Span[],
  from: number,
  to: number,
): { readonly name: string; readonly held: number } | undefined => {
  const most = mostWithin(renders, from, to);
  if (most === undefined) return undefined;
  const held = overlap(most, from, to);
  let named = most;
  for (const span of renders) {
    if (span === most || !within(span, from, to)) continue;
    if (span.from < most.from || span.to > most.to) continue;
    const part = overlap(span, from, to);
    if (part * 2 >= held && part <= overlap(named, from, to)) named = span;
  }
  return { name: named.name, held };
};

export const createJsBlockLog = ({ write, screen }: JsBlockLogPorts): JsBlockLog => {
  const slices: Span[] = [];
  const renders: Span[] = [];
  const works: Span[] = [];
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
    firstSettled: (at) => {
      settledAt ??= at;
    },
    longTask: (startTime, durationMs) => {
      if (durationMs <= JS_BLOCK_MS) return;
      const end = startTime + durationMs;
      // A slice inside the task beats the work running around it: the one that held most of it.
      const slice = mostWithin(slices, startTime, end);
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
        (settledAt === null || startTime < settledAt ? STARTUP : null);
      log(durationMs, name);
    },
  };
};
