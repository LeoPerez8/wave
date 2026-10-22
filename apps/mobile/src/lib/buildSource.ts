/** A derived build may only publish one consistent source version. */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

export const createBuildSource = () => {
  let version = 0;
  const listeners = new Set<() => void>();
  class Changed extends Error {}
  return {
    changed: (): void => {version++; for (const listener of listeners) listener();},
    run: <A,E,R>(read: Effect.Effect<A,E,R>, between: Effect.Effect<void>): Effect.Effect<A,E,R> => Effect.gen(function* () {
      for (;;) {
        const started = version;
        const changed = Effect.callback<never, Changed>(resume => {
          const listener = () => resume(Effect.fail(new Changed()));
          listeners.add(listener);
          return Effect.sync(() => {listeners.delete(listener);});
        });
        const result = yield* Effect.result(Effect.raceFirst(read,changed));
        if (version !== started) {yield* between; continue;}
        if (Result.isSuccess(result)) return result.success;
        // Changed is emitted only after increasing the version above.
        return yield* Effect.fail(result.failure as E);
      }
    }),
  };
};
