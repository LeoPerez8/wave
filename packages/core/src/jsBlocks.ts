/**
 * The app log's line for a JS block over 50 ms while a screen is shown
 * (#1350, #1359), naming the work that held the thread: the slice the block
 * ran in, else the named work still running then (begun and not ended, or
 * a free turn's work shortly after its turn), else "startup" before the
 * first screen settled, with the startup step under way (#1434), else none. A screen or section rendering in the
 * block (#1423) names it as "rendering <name>" when it held more of the
 * block than any slice did, and beats running work. A block that spans Wave
 * leaving the screen (#1446) is the phone pausing the process, not work: it is
 * written apart, as "JS paused", so no total of blocks counts it. A block is named when it's
 * judged, so a render whose commit is reported after the long task still names it (#1449).
 * Each block gets one line (#1432): a slice that wrote its own keeps its long task from adding
 * another, however much background work ran before that task was reported or judged. A startup
 * start is "startup <name>" only during startup; one that waited minutes is just <name>.
 */
import { timingDuration } from "./timing.ts";

/** A block longer than this, with a screen shown, is a bug to file. */
export const JS_BLOCK_MS = 50;

/**
 * How long slices, works, renders and trips off screen are kept to match a long task against: a
 * long task is reported after its own task, and judged a moment later, while background work
 * keeps running slices meanwhile, so a count of recent spans could lose the one it ran in.
 */
const KEPT_MS = 10_000;

/** At least this many recent spans stay, however old, for a long task as long as a pause. */
const KEPT = 16;

/** One commit can end several screens' and sections' renders. */
const KEPT_RENDERS = 32;

/** At most this many spans stay, however recent. */
const KEPT_MAX = 4096;

/**
 * How long after the first screen settled a startup start's turn still counts as startup's: one
 * that waited longer for quiet frames (the owner kept using Wave) runs as ordinary work.
 */
export const STARTUP_WORK_MS = 60_000;

/**
 * How long after its free turn a work counts as still running when it never says it ended: its
 * awaited reads answer within this, and a later block is no longer its.
 */
export const TURN_WORK_MS = 1000;

/**
 * How long after a block ended JS may still hear that Wave left the screen during it: the app
 * state change waits behind the block, so a block is judged only this long after it's reported.
 */
export const PAUSE_HEARD_MS = 250;

export interface JsBlockLogPorts {
  readonly write: (line: string) => void;
  /** The screen shown, or null while none is (Wave in the background). */
  readonly screen: () => string | null;
  /**
   * Runs [run] [ms] from now. Without it a block is judged as it's reported, so a pause heard
   * after its long task is missed.
   */
  readonly later?: (ms: number, run: () => void) => void;
}

export interface JsBlockLog {
  /** A background slice ran: whose, when it began and how long it held the thread. */
  readonly sliceRan: (name: string, startedAt: number, durationMs: number) => void;
  /**
   * The scheduler gave [name] a free turn at [at]: what runs on it, and its awaited
   * continuations, count as [name]'s work for [forMs] (`TURN_WORK_MS`), or until its next turn.
   * Work that names its continuations itself (as slices) passes 0: only the turn's own task is
   * its, and a render or anything else that follows is not put down to it (#1449).
   */
  readonly turnTaken: (name: string, at: number, forMs?: number) => void;
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
  /** JS heard at [at] that Wave left the screen (the app is no longer active). */
  readonly left: (at: number) => void;
  /** JS heard at [at] that Wave is on screen again. */
  readonly returned: (at: number) => void;
  /** The runtime reported a long task (`PerformanceObserver`'s "longtask"), on the same clock. */
  readonly longTask: (startTime: number, durationMs: number) => void;
  /**
   * The name of the work a startup start ([name]) does when it gets its turn at [at]: "startup
   * <name>" before the first screen settled or within `STARTUP_WORK_MS` after, else [name].
   */
  readonly startupWork: (name: string, at: number) => string;
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

// not UI text: the app log's line
export const jsPausedLine = (block: {
  readonly durationMs: number;
  readonly screen: string;
}): string =>
  `JS paused ${timingDuration(block.durationMs)} on ${block.screen} (Wave left the screen meanwhile); not a block`;

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

export const createJsBlockLog = ({ write, screen, later }: JsBlockLogPorts): JsBlockLog => {
  const slices: Span[] = [];
  const renders: Span[] = [];
  const works: Span[] = [];
  const steps: { readonly name: string; readonly at: number }[] = [];
  /** The times Wave was off screen, as JS heard them; the last one open while it still is. */
  const away: Span[] = [];
  let settledAt: number | null = null;
  /**
   * Writes the block [from, from + durationMs] on the screen shown now, once a pause during it
   * would have been heard. Whether a screen was shown is known at once; the work that held it
   * ([work], or no line when it says false) is asked then too, so what JS heard meanwhile, a
   * render's commit or a slice, counts.
   */
  const log = (from: number, durationMs: number, work: () => string | null | false): boolean => {
    const shown = screen();
    if (shown === null) return false;
    const judge = () => {
      const named = work();
      if (named === false) return;
      const to = from + durationMs;
      const pausedMeanwhile = away.some((span) => within(span, from, to + PAUSE_HEARD_MS));
      write(
        pausedMeanwhile
          ? jsPausedLine({ durationMs, screen: shown })
          : jsBlockLine({ durationMs, screen: shown, work: named }),
      );
    };
    if (later === undefined) judge();
    else later(PAUSE_HEARD_MS, judge);
    return true;
  };
  /**
   * Adds [span], dropping the spans that ended `KEPT_MS` before it began beyond the [kept] latest.
   * They go from the front as they age; a work still running there holds the rest back until the
   * list is full, when stale spans go from anywhere, and then the oldest.
   */
  const keep = (list: Span[], span: Span, kept = KEPT): void => {
    list.push(span);
    const stale = (old: Span) => old.to < span.from - KEPT_MS;
    let drop = 0;
    while (list.length - drop > kept && stale(list[drop]!)) drop++;
    if (drop > 0) list.splice(0, drop);
    if (list.length <= KEPT_MAX) return;
    let excess = list.length - kept;
    let at = 0;
    for (const old of list) {
      if (excess > 0 && stale(old)) excess--;
      else list[at++] = old;
    }
    list.length = at;
    if (list.length > KEPT_MAX) list.splice(0, list.length - KEPT_MAX);
  };
  /** Startup's name for a block ending at [end]: with the latest step begun before it. */
  const startup = (end: number): string => {
    let step: string | undefined;
    for (const { name, at } of steps) if (at < end) step = name;
    return step === undefined ? STARTUP : `${STARTUP} (${step})`;
  };
  return {
    sliceRan: (name, startedAt, durationMs) => {
      const logged = durationMs > JS_BLOCK_MS && log(startedAt, durationMs, () => name);
      keep(slices, { name, from: startedAt, to: startedAt + durationMs, logged });
    },
    turnTaken: (name, at, forMs = TURN_WORK_MS) => {
      // The same work's previous turn ended where this one begins.
      for (const work of works) if (work.name === name && work.to > at) work.to = at;
      keep(works, { name, from: at, to: at + forMs, logged: false });
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
    left: (at) => {
      if (away.at(-1)?.to !== Number.POSITIVE_INFINITY)
        keep(away, { name: "away", from: at, to: Number.POSITIVE_INFINITY, logged: false });
    },
    returned: (at) => {
      const last = away.at(-1);
      if (last?.to === Number.POSITIVE_INFINITY) last.to = at;
    },
    startupWork: (name, at) =>
      settledAt === null || at - settledAt <= STARTUP_WORK_MS ? `${STARTUP} ${name}` : name,
    longTask: (startTime, durationMs) => {
      if (durationMs <= JS_BLOCK_MS) return;
      const end = startTime + durationMs;
      log(startTime, durationMs, () => {
        // A slice inside the task beats the work running around it: the one that held most of it.
        const slice = mostWithin(slices, startTime, end);
        if (slice?.logged === true) return false;
        const render = renderWithin(renders, startTime, end);
        const rendering =
          render !== undefined &&
          (slice === undefined || render.held > overlap(slice, startTime, end))
            ? `rendering ${render.name}`
            : undefined;
        return (
          rendering ??
          slice?.name ??
          latestWithin(works, startTime, end)?.name ??
          (settledAt === null || startTime < settledAt ? startup(end) : null)
        );
      });
    },
  };
};
