/** Shared bounded CPU adapter (#593/#594): four-ms work, two-ms headroom, 512 operations. */
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
        if (now() - start >= 4) break;
      }
      yield* between;
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        steps.return(undefined as A);
      }),
    ),
  );
