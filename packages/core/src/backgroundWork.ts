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
  /**
   * A tap's transition holds every slice until it settles (#1350), maxWaitMs
   * or not; one that never reports its end holds work this long at most.
   */
  readonly transitionCapMs: number;
  /** The most one slice of stepped work may hold the JavaScript thread. */
  readonly sliceMs: number;
}

export const BACKGROUND_WORK_LIMITS: BackgroundWorkLimits = {
  quietMs: 400,
  maxWaitMs: 2000,
  takeoverMs: 3000,
  contentCapMs: 3000,
  transitionCapMs: 5000,
  sliceMs: 8,
};

export interface BackgroundWorkOptions {
  readonly now: () => number;
  /** Runs [run] in [ms], on its own turn of the event loop; returns the cancel. */
  readonly schedule: (ms: number, run: () => void) => () => void;
  readonly limits?: Partial<BackgroundWorkLimits>;
  /** Hears each slice `runSlice` ran: whose it was, when it began and how long it held the thread. */
  readonly sliceRan?: (name: string, startedAt: number, durationMs: number) => void;
}

/** What one slice of stepped work came to. */
export type SliceResult<A> = { readonly done: false } | { readonly done: true; readonly value: A };

/** What a caller asks of one slice, within the scheduler's own `sliceMs`. */
export interface SliceLimits {
  readonly sliceMs?: number;
  readonly maxSteps?: number;
}

/**
 * Runs [steps] for one slice: at least one step, then more while the
 * longest step so far still fits in [sliceMs], and at most [maxSteps].
 * A single step longer than the slice can't be split; it runs alone.
 */
export const runStepSlice = <A>(
  steps: Iterator<void, A>,
  {
    now,
    sliceMs,
    maxSteps,
  }: { readonly now: () => number; readonly sliceMs: number; readonly maxSteps: number },
): SliceResult<A> => {
  const startedAt = now();
  let longestStep = 0;
  for (let taken = 0; taken < maxSteps; taken++) {
    const before = now();
    if (taken > 0 && before - startedAt + longestStep > sliceMs) break;
    const next = steps.next();
    longestStep = Math.max(longestStep, now() - before);
    if (next.done === true) return { done: true, value: next.value };
  }
  return { done: false };
};

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
  /** The longest one slice of stepped work held the JavaScript thread. */
  readonly longestSliceMs: number;
  /** How many slices went past `sliceMs`, by the work's name (a step too long to split). */
  readonly overBudget: Readonly<Record<string, number>>;
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
  /** A tap's transition began: no slice starts until it ends (or `transitionCapMs` passes). */
  readonly transitionStarted: () => void;
  /** The tap's transition settled or was cancelled. */
  readonly transitionEnded: () => void;
  /** Whether a tap's transition holds work now. */
  readonly transitionInFlight: () => boolean;
  /**
   * Runs [run] on its own turn once no tap's transition is in flight, the
   * quiet after a touch or not: for work that paces itself by frames.
   * Returns the cancel.
   */
  readonly afterTransition: (run: () => void) => () => void;
  /**
   * Startup work: [start] runs on a free turn once a screen showed its
   * content (`contentShown`), or `contentCapMs` after startup work was first
   * asked when no screen does. Each piece gets its own turn, in the order asked.
   */
  readonly afterContent: (start: () => void) => void;
  /** A screen in sight shows its first content: startup work may begin. */
  readonly contentShown: () => void;
  /**
   * Runs [steps] for one slice, on the caller's turn (`runStepSlice`), within
   * `sliceMs` and what [limits] ask. [name] names the work for the perf stats
   * and the app log.
   */
  readonly runSlice: <A>(
    name: string,
    steps: Iterator<void, A>,
    limits?: SliceLimits,
  ) => SliceResult<A>;
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
  sliceRan,
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
  /** When the transition in flight stops holding work (its cap), or null with none. */
  let transitionUntil: number | null = null;
  const transitionWaiters: (() => void)[] = [];
  let cancelTransitionTimer: (() => void) | null = null;
  const inFlight = (): boolean => transitionUntil !== null && now() < transitionUntil;
  /** Lets the frame-paced waiters go once no transition holds them, each on the same next turn. */
  const armTransition = (): void => {
    cancelTransitionTimer?.();
    cancelTransitionTimer = null;
    if (transitionWaiters.length === 0) return;
    const wait = inFlight() ? transitionUntil! - now() : 0;
    cancelTransitionTimer = schedule(wait, () => {
      cancelTransitionTimer = null;
      if (inFlight()) {
        armTransition();
        return;
      }
      for (const run of transitionWaiters.splice(0)) run();
    });
  };

  /** When the owner leaves the JavaScript thread free: no touch held, quiet since the last. */
  const quietAt = (): number => (held ? Infinity : interactedAt + limits.quietMs);

  /**
   * When [waiter] may run: once quiet, or once it waited `maxWaitMs`, and
   * never while a tap's transition is in flight.
   */
  const dueAt = (waiter: Waiter): number =>
    Math.max(transitionUntil ?? -Infinity, Math.min(waiter.askedAt + limits.maxWaitMs, quietAt()));

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

  let longestSliceMs = 0;
  const overBudget: Record<string, number> = {};

  const runSlice = <A>(
    name: string,
    steps: Iterator<void, A>,
    asked: SliceLimits = {},
  ): SliceResult<A> => {
    const startedAt = now();
    try {
      return runStepSlice(steps, {
        now,
        sliceMs: Math.min(limits.sliceMs, asked.sliceMs ?? Infinity),
        maxSteps: asked.maxSteps ?? Infinity,
      });
    } finally {
      const durationMs = now() - startedAt;
      longestSliceMs = Math.max(longestSliceMs, durationMs);
      if (durationMs > limits.sliceMs) overBudget[name] = (overBudget[name] ?? 0) + 1;
      sliceRan?.(name, startedAt, durationMs);
    }
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
    transitionStarted: () => {
      transitionUntil = now() + limits.transitionCapMs;
      arm();
      armTransition();
    },
    transitionEnded: () => {
      transitionUntil = null;
      arm();
      armTransition();
    },
    transitionInFlight: inFlight,
    afterTransition: (run) => {
      let waiting = true;
      const waiter = (): void => {
        waiting = false;
        run();
      };
      transitionWaiters.push(waiter);
      if (transitionWaiters.length === 1) armTransition();
      return () => {
        if (!waiting) return;
        waiting = false;
        const index = transitionWaiters.indexOf(waiter);
        if (index !== -1) transitionWaiters.splice(index, 1);
        if (transitionWaiters.length === 0) armTransition();
      };
    },
    afterContent,
    contentShown: () => letGo(false),
    runSlice,
    stats: () => ({
      contentAt,
      contentCapped,
      startupStarted,
      slices,
      longestWaitMs,
      forcedSlices,
      longestSliceMs,
      overBudget: { ...overBudget },
    }),
  };
};
