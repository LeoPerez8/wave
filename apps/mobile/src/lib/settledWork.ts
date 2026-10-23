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

type SettledGate = Pick<SettledScheduler, "settled" | "subscribe">;

/**
 * Settlement protects what's on screen. Backgrounded (a locked phone, Android
 * Auto), nothing is, so the gate stands open: a Magic Queue batch or an
 * import doesn't wait for the owner to come back.
 */
export const openWhileBackgrounded = (
  gate: SettledGate,
  app: { readonly backgrounded: () => boolean; readonly subscribe: SettledGate["subscribe"] },
): SettledGate => ({
  settled: () => app.backgrounded() || gate.settled(),
  subscribe: (listener) => {
    const stopGate = gate.subscribe(listener);
    const stopApp = app.subscribe(listener);
    return () => {
      stopGate();
      stopApp();
    };
  },
});
