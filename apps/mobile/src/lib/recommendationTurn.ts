/** Effect adapter; a single instance budgets all recommendation pages and CPU slices. */
import { recommendationFrameBudget } from "@wave/core";
import * as Effect from "effect/Effect";
import { checkRecommendationDeadlines } from "./recommendationTimeout.ts";

export const createRecommendationTurn = (host: {
  readonly now: () => number;
  readonly intervalMs: () => number;
  readonly request: (run: () => void) => () => void;
}): Effect.Effect<void> => {
  const budget = recommendationFrameBudget(host);
  const waiters = new Set<() => void>();
  let cancel: (() => void) | undefined;
  const turn: Effect.Effect<void> = Effect.suspend(() => {
    checkRecommendationDeadlines();
    if (!budget.due()) return Effect.void;
    return Effect.callback<void>((resume) => {
      // Recheck the shared budget: a peer may have used it before this reader resumes.
      const ready = () => resume(turn);
      waiters.add(ready);
      cancel ??= host.request(() => {
        const release = cancel;
        cancel = undefined;
        release?.();
        budget.yielded();
        const current = [...waiters];
        waiters.clear();
        for (const wake of current) wake();
      });
      return Effect.sync(() => {
        if (waiters.delete(ready) && waiters.size === 0) {
          cancel?.();
          cancel = undefined;
        }
      });
    });
  });
  return turn;
};
