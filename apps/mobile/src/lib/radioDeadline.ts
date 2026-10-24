import { recommendationDeadline } from "@wave/core";
import * as Effect from "effect/Effect";

/** Radio network deadlines, checked on foreground resume as well as by timers. */
const checks = new Set<() => void>();
const deadlineElapsed = () => Effect.fail(new Error("Radio deadline elapsed"));

/** Called on foreground resume and at recommendation work boundaries, even if timers slept. */
export const checkRadioDeadlines = (): void => {
  for (const check of checks) check();
};

/** A network deadline rejects late radio responses. */
export const withRadioDeadline = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  timeoutMs: number,
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
