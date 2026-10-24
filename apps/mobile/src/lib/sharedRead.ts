/**
 * A read done once and shared: everyone who asks while it's kept gets the
 * same answer, those who ask while it's being read wait for it. Home's mix
 * builds share the Library's indexes and the candidate catalog this way
 * (for a minute), and the artist graph (for the session). Kept free of Expo
 * so it runs under plain Node tests.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { withRecommendationDeadline } from "./recommendationTimeout.ts";

/**
 * How many reads one ask waits through. A forget while the answer is read
 * reads it again for those waiting, up to this many reads in all; past it
 * the ask fails ("Shared read invalidated"), so sources that change faster
 * than the read finishes can't keep a waiter reading forever.
 */
export const SHARED_READ_ATTEMPTS = 4;

/** A read shared by everyone who asks while it's kept. */
export interface SharedRead<A, R> {
  /**
   * The answer: read the first time it's asked for (with the services of
   * whoever asked), then shared. A failed read isn't kept: the next ask
   * reads again. Never an answer read before a forget: whoever waits on a
   * read that's forgotten waits on the read after it (`SHARED_READ_ATTEMPTS`).
   */
  readonly get: Effect.Effect<A, unknown, R>;
  /** Forgets the answer: the next ask reads again, and so does whoever waits on it. */
  readonly forget: () => void;
  /** Cancels work and releases waiters permanently. */
  readonly dispose: () => void;
}

/**
 * [read], shared (`SharedRead`): kept [keepMs] (forever when absent) from
 * when it started, as [now] tells the time.
 */
export const sharedRead = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  { keepMs, now = Date.now }: { readonly keepMs?: number; readonly now?: () => number } = {},
): SharedRead<A, R> => {
  type Entry = {
    readonly at: number;
    readonly answer: Promise<A>;
    readonly controller: AbortController;
    users: number;
    done: boolean;
    /** Forgotten, not just aged out: its answer may be from before a change. */
    forgotten: boolean;
  };
  let shared: Entry | null = null;
  let disposed = false;
  const forget = () => {
    const entry = shared;
    shared = null;
    if (entry === null) return;
    entry.forgotten = true;
    if (!entry.done) entry.controller.abort();
  };
  /** The entry to wait on: the one kept, or a read started now. */
  const entryNow = Effect.gen(function* () {
    const at = now();
    // Aged out, not forgotten: whoever already waits on it still takes its answer.
    if (shared !== null && shared.done && keepMs !== undefined && at - shared.at > keepMs)
      shared = null;
    if (shared === null) {
      const context = yield* Effect.context<R>();
      const controller = new AbortController();
      const entry: Entry = {
        at,
        answer: Effect.runPromiseWith(context)(read, { signal: controller.signal }),
        controller,
        users: 0,
        done: false,
        forgotten: false,
      };
      shared = entry;
      void entry.answer.then(
        () => {
          entry.done = true;
        },
        () => {
          entry.done = true;
          if (shared === entry) shared = null;
        },
      );
    }
    return shared;
  });
  const get = Effect.gen(function* () {
    for (let attempt = 1; ; attempt++) {
      if (disposed) return yield* Effect.fail(new Error("Shared read disposed"));
      const entry = yield* entryNow;
      entry.users++;
      const answer = yield* Effect.result(
        Effect.tryPromise({
          try: () => entry.answer,
          catch: (cause) => cause,
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.users--;
            if (entry.users === 0 && !entry.done) {
              if (shared === entry) shared = null;
              entry.controller.abort();
            }
          }),
        ),
      );
      if (disposed) return yield* Effect.fail(new Error("Shared read disposed"));
      if (!entry.forgotten) {
        if (Result.isSuccess(answer)) return answer.success;
        return yield* Effect.fail(answer.failure);
      }
      if (attempt >= SHARED_READ_ATTEMPTS)
        return yield* Effect.fail(new Error("Shared read invalidated"));
    }
  }).pipe(withRecommendationDeadline);
  return {
    get,
    forget,
    dispose: () => {
      disposed = true;
      forget();
    },
  };
};
