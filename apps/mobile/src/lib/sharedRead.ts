/**
 * A read done once and shared: everyone who asks while it's kept gets the
 * same answer, those who ask while it's being read wait for it. Home's mix
 * builds share the Library's indexes and the candidate catalog this way
 * (for a minute), and the artist graph (for the session). Kept free of Expo
 * so it runs under plain Node tests.
 */
import * as Effect from "effect/Effect";

/** A read shared by everyone who asks while it's kept. */
export interface SharedRead<A, R> {
  /**
   * The answer: read the first time it's asked for (with the services of
   * whoever asked), then shared. A failed read isn't kept: the next ask
   * reads again.
   */
  readonly get: Effect.Effect<A, unknown, R>;
  /** Forgets the answer: the next ask reads again. */
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
  };
  let shared: Entry | null = null;
  let disposed = false;
  const forget = () => {
    const entry = shared;
    shared = null;
    if (entry !== null && !entry.done) entry.controller.abort();
  };
  const get = Effect.gen(function* () {
    if (disposed) return yield* Effect.fail(new Error("Shared read disposed"));
    const at = now();
    if (shared !== null && shared.done && keepMs !== undefined && at - shared.at > keepMs) forget();
    if (shared === null) {
      const context = yield* Effect.context<R>();
      const controller = new AbortController();
      const entry: Entry = {
        at,
        answer: Effect.runPromiseWith(context)(read, { signal: controller.signal }),
        controller,
        users: 0,
        done: false,
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
    const entry = shared;
    entry.users++;
    const answer = yield* Effect.tryPromise({
      try: () => entry.answer,
      catch: (cause) => cause,
    }).pipe(
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
    if (disposed || shared !== entry)
      return yield* Effect.fail(new Error("Shared read invalidated"));
    return answer;
  });
  return {
    get,
    forget,
    dispose: () => {
      disposed = true;
      forget();
    },
  };
};
