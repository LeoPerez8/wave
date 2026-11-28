/** Effect adapter; a single instance budgets all recommendation pages and CPU slices. */
import { recommendationFrameBudget } from "@wave/core";
import * as Effect from "effect/Effect";
import { checkRadioDeadlines } from "./radioDeadline.ts";
import {
  BackgroundWorkName,
  GENTLE_STEPS,
  pacedSteps,
  type StepPace,
  type Turn,
} from "./stepped.ts";

/** Awaited steps: the frame budget alone stops them, checked often enough not to overrun it far. */
const AWAITED_STEPS: Omit<StepPace, "between"> = {
  sliceMs: 2,
  maxSteps: Number.POSITIVE_INFINITY,
};

export const createRecommendationWork = (host: {
  readonly now: () => number;
  readonly intervalMs: () => number;
  readonly request: (run: () => void) => () => void;
  /** The shared scheduler's gate: background turns wait out a tap's transition (#1350). */
  readonly transition?: {
    readonly inFlight: () => boolean;
    readonly after: (run: () => void) => () => void;
  };
  /**
   * [name] got its turn (the block log's `turnTaken`, #1447): the pages it reads next run
   * outside any slice, so without the mark a long one isn't put down to its work.
   */
  readonly turnTaken?: (name: string) => void;
}) => {
  const budget = recommendationFrameBudget(host);
  const waiters = new Set<() => void>();
  let cancel: (() => void) | undefined;
  /** Awaited work running now: background turns wait until there's none. */
  let awaitedWork = 0;
  const paused = new Set<() => void>();
  /** The upcoming frame, shared by every reader; [after] rechecks once it has passed. */
  const nextFrame = (after: () => Effect.Effect<void>) =>
    Effect.callback<void>((resume) => {
      // Recheck the shared budget: a peer may have used it before this reader resumes.
      const ready = () => resume(after());
      waiters.add(ready);
      cancel ??= host.request(() => {
        const release = cancel;
        cancel = undefined;
        release?.();
        budget.yielded();
        const current = [...waiters];
        waiters.clear();
        for (const wake of current) wake();
      });
      return Effect.sync(() => {
        if (waiters.delete(ready) && waiters.size === 0) {
          cancel?.();
          cancel = undefined;
        }
      });
    });
  const frameTurn: Effect.Effect<void> = Effect.suspend(() => {
    checkRadioDeadlines();
    const transition = host.transition;
    if (transition?.inFlight() === true)
      return Effect.callback<void>((resume) => {
        const cancel = transition.after(() => resume(frameTurn));
        return Effect.sync(cancel);
      });
    if (awaitedWork > 0)
      return Effect.callback<void>((resume) => {
        const ready = () => resume(frameTurn);
        paused.add(ready);
        return Effect.sync(() => {
          paused.delete(ready);
        });
      });
    return budget.due() ? nextFrame(() => frameTurn) : Effect.void;
  });
  /** [inner], then the mark that what runs next is the waiting work's. */
  const marked = (inner: Effect.Effect<void>): Turn =>
    Effect.gen(function* () {
      const name = yield* BackgroundWorkName;
      yield* inner;
      host.turnTaken?.(name);
    });
  const turn = marked(frameTurn);
  const awaitedFrameTurn: Effect.Effect<void> = Effect.suspend(() => {
    checkRadioDeadlines();
    return budget.dueAwaited() ? nextFrame(() => awaitedFrameTurn) : Effect.void;
  });
  const awaitedTurn = marked(awaitedFrameTurn);
  return {
    /** Between background pages and slices: the frame's turn, after any work someone waits for. */
    turn,
    /**
     * Runs [steps], asking [awaited] at each slice whether someone waits for them. While someone
     * does they get the longer run per frame and no step cap, and background turns pause: nothing
     * they wait for depends on those, so the pause can't hold itself up. Otherwise, they run
     * as any background work does.
     */
    steps: <A>(
      steps: Generator<void, A>,
      awaited: () => boolean,
    ): Effect.Effect<A, never, BackgroundWorkName> =>
      Effect.suspend(() => {
        let holding = false;
        const hold = (wanted: boolean) => {
          if (wanted === holding) return;
          holding = wanted;
          awaitedWork += wanted ? 1 : -1;
          if (awaitedWork > 0) return;
          const current = [...paused];
          paused.clear();
          for (const wake of current) wake();
        };
        return pacedSteps(
          steps,
          () => {
            const waiting = awaited();
            hold(waiting);
            return waiting
              ? { ...AWAITED_STEPS, between: awaitedTurn }
              : { ...GENTLE_STEPS, between: turn };
          },
          host.now,
        ).pipe(Effect.ensuring(Effect.sync(() => hold(false))));
      }),
  };
};
