/** Bounded cancellable CPU work, using the caller's actual task scheduler. */
import * as Effect from "effect/Effect";

export const runSteps = <A>(
  steps: Generator<void, A>,
  between: Effect.Effect<void>,
  now: () => number = () => performance.now(),
): Effect.Effect<A> =>
  Effect.gen(function* () {
    // A new CPU stage must not append its budget to the preceding stage's last task.
    yield* between;
    for (;;) {
      const start = now();
      // A work cap also bounds deterministic tests and exceptionally cheap operations.
      for (let work = 0; work < 512; work++) {
        const next = steps.next();
        if (next.done) return next.value;
        if (now() - start >= 6) break;
      }
      yield* between;
    }
  });
