/**
 * When background work (startup's scan, resumed imports and sync, a scan's
 * batches, a sync's steps) may take its next slice of the JavaScript
 * thread, so it never competes with what the owner is doing: it starts once
 * the first screen shows content, and each slice waits for a free turn, one
 * slice per turn.
 */

/** How background work is paced. */
export interface BackgroundWorkLimits {
  /** Work waits until no touch was held for this long (a navigation's motion runs meanwhile). */
  readonly quietMs: number;
  /** Work never waits longer than this from when it asked, however long the owner interacts. */
  readonly maxWaitMs: number;
  /**
   * A touch a native scroll or gesture took over counts as held this long,
   * then as lifted: its lift is never heard, and a scroll's fling runs on
   * after it.
   */
  readonly takeoverMs: number;
  /**
   * Startup work waits at most this long, from when it was first asked, for
   * a screen to show content: a safety net for a launch whose screen reads
   * nothing, not the usual start.
   */
  readonly contentCapMs: number;
}

export const BACKGROUND_WORK_LIMITS: BackgroundWorkLimits = {
  quietMs: 400,
  maxWaitMs: 2000,
  takeoverMs: 3000,
  contentCapMs: 3000,
};

export interface BackgroundWorkOptions {
  readonly now: () => number;
  /** Runs [run] in [ms], on its own turn of the event loop; returns the cancel. */
  readonly schedule: (ms: number, run: () => void) => () => void;
  readonly limits?: Partial<BackgroundWorkLimits>;
}

/** What a perf build reports of background work since launch. */
export interface BackgroundWorkStats {
  /** When startup work was let go (the clock's time), or null while it waits. */
  readonly contentAt: number | null;
  /** Let go by `contentCapMs`, not by a screen's content. */
  readonly contentCapped: boolean;
  /** Startup pieces started so far. */
  readonly startupStarted: number;
  /** Slices run (startup pieces included). */
  readonly slices: number;
  /** The longest a slice waited for its turn. */
  readonly longestWaitMs: number;
  /** Slices run by `maxWaitMs` while the owner was still interacting. */
  readonly forcedSlices: number;
}

export interface BackgroundWork {
  /** Runs [run] on the next free turn; returns the cancel. */
  readonly whenFree: (run: () => void) => () => void;
  /** A finger went down. */
  readonly touchStarted: () => void;
  /** The fingers lifted. */
  readonly touchEnded: () => void;
  /**
   * A native scroll or gesture took the touch over: the finger may still be
   * down, and its lift won't be heard. Counts as held for `takeoverMs`.
   */
  readonly touchTakenOver: () => void;
  /** Wave came back to the foreground: work waits as after a touch, for the owner's first tap. */
  readonly resumed: () => void;
  /**
   * Startup work: [start] runs on a free turn once a screen showed its
   * content (`contentShown`), or `contentCapMs` after startup work was first
   * asked when no screen does. Each piece gets its own turn, in the order asked.
   */
  readonly afterContent: (start: () => void) => void;
  /** A screen in sight shows its first content: startup work may begin. */
  readonly contentShown: () => void;
  readonly stats: () => BackgroundWorkStats;
}

interface Waiter {
  readonly askedAt: number;
  readonly run: () => void;
}

export const createBackgroundWork = ({
  now,
  schedule,
  limits: given = {},
}: BackgroundWorkOptions): BackgroundWork => {
  const limits = { ...BACKGROUND_WORK_LIMITS, ...given };
  const waiters: Waiter[] = [];
  let held = false;
  /** When the owner last touched, or, after a takeover, when the finger presumably lifts. */
  let interactedAt = -Infinity;
  let cancelTimer: (() => void) | null = null;
  let slices = 0;
  let longestWaitMs = 0;
  let forcedSlices = 0;

  /** When the owner leaves the JavaScript thread free: no touch held, quiet since the last. */
  const quietAt = (): number => (held ? Infinity : interactedAt + limits.quietMs);

  /** When [waiter] may run: once quiet, or once it waited `maxWaitMs`. */
  const dueAt = (waiter: Waiter): number => Math.min(waiter.askedAt + limits.maxWaitMs, quietAt());

  /** Sets the one timer, for the first waiter. */
  const arm = (): void => {
    cancelTimer?.();
    cancelTimer = null;
    const first = waiters[0];
    if (first === undefined) return;
    cancelTimer = schedule(Math.max(0, dueAt(first) - now()), pump);
  };

  /**
   * Runs the first waiter when it's due; one per turn, so each turn re-checks
   * for a touch. The next turn is set even when the waiter throws.
   */
  const pump = (): void => {
    cancelTimer = null;
    const first = waiters[0];
    if (first === undefined) return;
    const time = now();
    if (dueAt(first) > time) {
      arm();
      return;
    }
    waiters.shift();
    slices += 1;
    longestWaitMs = Math.max(longestWaitMs, time - first.askedAt);
    if (quietAt() > time) forcedSlices += 1;
    try {
      first.run();
    } finally {
      arm();
    }
  };

  const whenFree = (run: () => void): (() => void) => {
    const waiter: Waiter = { askedAt: now(), run };
    waiters.push(waiter);
    if (waiters.length === 1) arm();
    return () => {
      const index = waiters.indexOf(waiter);
      if (index === -1) return;
      waiters.splice(index, 1);
      if (index === 0) arm();
    };
  };

  const startup: (() => void)[] = [];
  let contentAt: number | null = null;
  let contentCapped = false;
  let startupStarted = 0;
  let cancelCap: (() => void) | null = null;

  const startPiece = (start: () => void): void => {
    whenFree(() => {
      startupStarted += 1;
      start();
    });
  };

  /** Lets startup work go: content showed, or the cap ran out. */
  const letGo = (capped: boolean): void => {
    if (contentAt !== null) return;
    contentAt = now();
    contentCapped = capped;
    cancelCap?.();
    cancelCap = null;
    for (const start of startup.splice(0)) startPiece(start);
  };

  const afterContent = (start: () => void): void => {
    if (contentAt !== null) {
      startPiece(start);
      return;
    }
    startup.push(start);
    cancelCap ??= schedule(limits.contentCapMs, () => letGo(true));
  };

  const interacted = (at = now()): void => {
    interactedAt = at;
    arm();
  };

  return {
    whenFree,
    touchStarted: () => {
      held = true;
      interacted();
    },
    touchEnded: () => {
      held = false;
      interacted();
    },
    touchTakenOver: () => {
      held = false;
      interacted(now() + limits.takeoverMs);
    },
    resumed: () => interacted(),
    afterContent,
    contentShown: () => letGo(false),
    stats: () => ({
      contentAt,
      contentCapped,
      startupStarted,
      slices,
      longestWaitMs,
      forcedSlices,
    }),
  };
};
