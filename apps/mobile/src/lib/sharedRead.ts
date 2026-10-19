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
}

/**
 * [read], shared (`SharedRead`): kept [keepMs] (forever when absent) from
 * when it started, as [now] tells the time.
 */
export const sharedRead = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  { keepMs, now = Date.now }: { readonly keepMs?: number; readonly now?: () => number } = {},
): SharedRead<A, R> => {
  let shared: { readonly at: number; readonly answer: Promise<A> } | null = null;
  const get = Effect.gen(function* () {
    const at = now();
    if (shared === null || (keepMs !== undefined && at - shared.at > keepMs)) {
      const context = yield* Effect.context<R>();
      const entry = { at, answer: Effect.runPromiseWith(context)(read) };
      shared = entry;
      entry.answer.catch(() => {
        if (shared === entry) shared = null;
      });
    }
    const { answer } = shared;
    return yield* Effect.tryPromise({ try: () => answer, catch: (cause) => cause });
  });
  return {
    get,
    forget: () => {
      shared = null;
    },
  };
};
