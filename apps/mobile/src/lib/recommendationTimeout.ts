import { recommendationDeadline } from "@wave/core";
import * as Effect from "effect/Effect";

/**
 * The longest a recommendation read may run (a Magic Queue batch, a mix's
 * build, a playlist's suggestions): past it, the read fails and its surface
 * shows the retry line instead of loading on (docs/spec.md).
 */
export const RECOMMENDATION_TIMEOUT = 60_000;

const checks = new Set<() => void>();
const deadlineElapsed = () => Effect.fail(new Error("Recommendation deadline elapsed"));

/** Called on foreground resume and at recommendation work boundaries, even if timers slept. */
export const checkRecommendationDeadlines = (): void => {
  for (const check of checks) check();
};

/** A deadline covers scheduler waits, reads and ranking, and rejects late results. */
export const withRecommendationDeadline = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  timeoutMs = RECOMMENDATION_TIMEOUT,
): Effect.Effect<A, E | Error, R> =>
  Effect.suspend(() => {
    const deadline = recommendationDeadline(timeoutMs);
    const timeout = Effect.callback<never, Error>((resume) => {
      let timer: ReturnType<typeof setTimeout>;
      const check = () => {
        if (deadline.expired()) resume(deadlineElapsed());
      };
      const tick = () => {
        if (deadline.expired()) resume(deadlineElapsed());
        else timer = setTimeout(tick, deadline.remainingMs());
      };
      checks.add(check);
      timer = setTimeout(tick, deadline.remainingMs());
      return Effect.sync(() => {
        checks.delete(check);
        clearTimeout(timer);
      });
    });
    return Effect.raceFirst(
      read.pipe(
        Effect.flatMap((value) => (deadline.expired() ? deadlineElapsed() : Effect.succeed(value))),
      ),
      timeout,
    );
  });
