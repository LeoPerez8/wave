/** A derived build may only publish one consistent source version. */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

/** A changing Library must finish with a retry line, even before the wall-clock deadline. */
const BUILD_ATTEMPTS = 4;

/**
 * Runs derived builds against a source version: a change while a build reads
 * cancels it, and the build starts again from the new version. Its output is
 * never published from a version it didn't read.
 */
export const createBuildSource = () => {
  let version = 0;
  const listeners = new Set<() => void>();
  class Changed extends Error {}
  return {
    changed: (): void => {
      version++;
      for (const listener of listeners) listener();
    },
    run: <A, E, R>(
      read: Effect.Effect<A, E, R>,
      between: Effect.Effect<void>,
    ): Effect.Effect<A, E | Error, R> =>
      Effect.gen(function* () {
        for (let attempt = 1; ; attempt++) {
          const started = version;
          const changed = Effect.callback<never, Changed>((resume) => {
            const listener = () => resume(Effect.fail(new Changed()));
            listeners.add(listener);
            return Effect.sync(() => {
              listeners.delete(listener);
            });
          });
          const result = yield* Effect.result(Effect.raceFirst(read, changed));
          if (version !== started) {
            if (attempt >= BUILD_ATTEMPTS)
              return yield* Effect.fail(new Error("Recommendation sources kept changing"));
            yield* between;
            continue;
          }
          if (Result.isSuccess(result)) return result.success;
          // Changed is emitted only after increasing the version above.
          return yield* Effect.fail(result.failure as E);
        }
      }),
  };
};
