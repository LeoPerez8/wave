/** Short-lived settlement observer, then a cancellable free turn. No polling. */
import * as Effect from "effect/Effect";

export interface SettledScheduler {
  readonly settled: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly schedule: (run: () => void) => () => void;
}
export const settledTurn = ({
  settled,
  subscribe,
  schedule,
}: SettledScheduler): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    let stop: (() => void) | undefined;
    let cancel: (() => void) | undefined;
    let ended = false;
    const check = () => {
      if (ended || cancel !== undefined || !settled()) return;
      cancel = schedule(() => {
        cancel = undefined;
        if (!settled()) return;
        ended = true;
        stop?.();
        resume(Effect.void);
      });
    };
    stop = subscribe(check);
    check();
    return Effect.sync(() => {
      ended = true;
      stop?.();
      cancel?.();
    });
  });
