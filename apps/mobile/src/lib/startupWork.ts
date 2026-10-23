/**
 * Background turns require global settlement, then three uninterrupted quiet frame intervals.
 * Backgrounded, there's no screen to protect (and frames may not run): free turns alone pace them.
 */
interface Ports {
  readonly now: () => number;
  readonly intervalMs?: () => number;
  readonly isSettled: () => boolean;
  /** Wave isn't in the foreground; [subscribe] also fires when that changes. */
  readonly backgrounded?: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly request: (run: () => void) => number;
  readonly cancel: (id: number) => void;
  readonly whenFree: (run: () => void) => () => void;
}

export const createStartupWork = (ports: Ports) => {
  const quietGap = () => {
    const interval = ports.intervalMs?.() ?? 0;
    return 1.5 * (interval > 0 ? interval : 1000 / 60);
  };
  const away = () => ports.backgrounded?.() === true;
  const waiting: { run: () => void }[] = [];
  let frame: number | undefined;
  let cancelTurn: (() => void) | undefined;
  let previous: number | undefined;
  let intervals = 0;
  let quiet = false;
  let disposed = false;
  const reset = () => {
    if (frame !== undefined) ports.cancel(frame);
    frame = undefined;
    cancelTurn?.();
    cancelTurn = undefined;
    previous = undefined;
    intervals = 0;
    quiet = false;
  };
  const arm = (): void => {
    if (disposed || waiting.length === 0 || (!away() && !ports.isSettled())) return;
    if (!quiet && !away()) {
      frame ??= ports.request(sample);
      return;
    }
    cancelTurn ??= ports.whenFree(() => {
      cancelTurn = undefined;
      // Navigation may have begun after the free turn was requested.
      if (
        !away() &&
        (!ports.isSettled() || previous === undefined || ports.now() - previous > quietGap())
      ) {
        reset();
        arm();
        return;
      }
      try {
        waiting.shift()?.run();
      } finally {
        arm();
      }
    });
  };
  const sample = () => {
    frame = undefined;
    if (!ports.isSettled()) {
      reset();
      return;
    }
    const now = ports.now();
    // Use the display cadence, including power-saving 30Hz; a late frame restarts the window.
    if (previous !== undefined) intervals = now - previous <= quietGap() ? intervals + 1 : 0;
    previous = now;
    quiet = intervals >= 3;
    arm();
  };
  const stop = ports.subscribe(() => {
    reset();
    arm();
  });
  return {
    whenFree: (run: () => void): (() => void) => {
      if (waiting.length === 0 && (previous === undefined || ports.now() - previous > quietGap()))
        reset();
      const waiter = { run };
      waiting.push(waiter);
      arm();
      return () => {
        const index = waiting.indexOf(waiter);
        if (index === -1) return;
        waiting.splice(index, 1);
        if (index === 0) {
          cancelTurn?.();
          cancelTurn = undefined;
        }
        if (waiting.length === 0) reset();
        else arm();
      };
    },
    dispose: () => {
      disposed = true;
      stop();
      reset();
      waiting.length = 0;
    },
  };
};
