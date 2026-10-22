import { advanceWork, WORK_SLICE_MS } from "@wave/core";
import * as Effect from "effect/Effect";

/** Two ms of headroom for Effect/clock/GC overhead within the six-ms target.
 * CPU steps on the existing scheduler's free turns; interruption cancels the pending turn. */
export const steppedWork = <A>(
  steps: Iterator<void, A>,
  turn: Effect.Effect<void>,
  now = () => performance.now(),
): Effect.Effect<A> =>
  Effect.gen(function* () {
    while (true) {
      yield* turn;
      const result = yield* Effect.sync(() => advanceWork(steps, now, WORK_SLICE_MS - 2));
      if (result.done) return result.value;
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        steps.return?.();
      }),
    ),
  );
