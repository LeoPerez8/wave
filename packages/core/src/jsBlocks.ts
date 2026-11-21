/**
 * The app log's line for a JS block over 50 ms while a screen is shown
 * (#1350), naming the background work that held the thread: the slice the
 * block ran in, else none.
 */
import { timingDuration } from "./timing.ts";

/** A block longer than this, with a screen shown, is a bug to file. */
export const JS_BLOCK_MS = 50;

/** How many recent slices a long task may be matched against. */
const KEPT_SLICES = 16;

export interface JsBlockLogPorts {
  readonly write: (line: string) => void;
  /** The screen shown, or null while none is (Wave in the background). */
  readonly screen: () => string | null;
}

export interface JsBlockLog {
  /** A background slice ran: whose, when it began and how long it held the thread. */
  readonly sliceRan: (name: string, startedAt: number, durationMs: number) => void;
  /**
   * The scheduler gave [name] a free turn at [at]: what runs on it (an
   * awaited turn's continuation) can't be timed, but a long task holding
   * that moment is that work's.
   */
  readonly turnTaken: (name: string, at: number) => void;
  /** The runtime reported a long task (`PerformanceObserver`'s "longtask"), on the same clock. */
  readonly longTask: (startTime: number, durationMs: number) => void;
}

// not UI text: the app log's line
export const jsBlockLine = (block: {
  readonly durationMs: number;
  readonly screen: string;
  readonly work: string | null;
}): string =>
  `JS blocked ${timingDuration(block.durationMs)} on ${block.screen} by ${block.work ?? "no background work"}`;

interface Slice {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly logged: boolean;
}

export const createJsBlockLog = ({ write, screen }: JsBlockLogPorts): JsBlockLog => {
  const slices: Slice[] = [];
  const log = (durationMs: number, work: string | null): boolean => {
    const shown = screen();
    if (shown === null) return false;
    write(jsBlockLine({ durationMs, screen: shown, work }));
    return true;
  };
  const keep = (slice: Slice): void => {
    slices.push(slice);
    if (slices.length > KEPT_SLICES) slices.shift();
  };
  return {
    sliceRan: (name, startedAt, durationMs) => {
      const logged = durationMs > JS_BLOCK_MS && log(durationMs, name);
      keep({ name, from: startedAt, to: startedAt + durationMs, logged });
    },
    turnTaken: (name, at) => keep({ name, from: at, to: at, logged: false }),
    longTask: (startTime, durationMs) => {
      if (durationMs <= JS_BLOCK_MS) return;
      const end = startTime + durationMs;
      // The latest first: a slice inside the task beats the turn it ran on.
      let within: Slice | undefined;
      for (let at = slices.length - 1; at >= 0 && within === undefined; at--) {
        const slice = slices[at]!;
        if (slice.from <= end && slice.to >= startTime) within = slice;
      }
      if (within?.logged === true) return;
      log(durationMs, within?.name ?? null);
    },
  };
};
