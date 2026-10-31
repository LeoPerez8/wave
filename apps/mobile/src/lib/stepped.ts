/** Shared bounded CPU adapter (#593/#594). */
import * as Effect from "effect/Effect";

/** One slice of stepped work, and what comes before it. */
export interface StepPace {
  readonly between: Effect.Effect<void>;
  readonly sliceMs: number;
  /** A work cap also bounds deterministic tests and exceptionally cheap operations. */
  readonly maxSteps: number;
}

/** Four-ms work, two-ms headroom, 512 operations. */
export const GENTLE_STEPS = { sliceMs: 4, maxSteps: 512 };

/** Runs [steps] in slices, each paced as [pace] says when it comes up. */
export const pacedSteps = <A>(
  steps: Generator<void, A>,
  pace: () => StepPace,
  now: () => number = () => performance.now(),
): Effect.Effect<A> =>
  Effect.gen(function* () {
    for (;;) {
      const { between, sliceMs, maxSteps } = pace();
      // A new CPU stage must not append its budget to the preceding stage's last task.
      yield* between;
      const start = now();
      for (let work = 0; work < maxSteps; work++) {
        const next = steps.next();
        if (next.done) return next.value;
        if (now() - start >= sliceMs) break;
      }
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        steps.return(undefined as A);
      }),
    ),
  );

export const runSteps = <A>(
  steps: Generator<void, A>,
  between: Effect.Effect<void>,
  now?: () => number,
): Effect.Effect<A> => pacedSteps(steps, () => ({ ...GENTLE_STEPS, between }), now);
