/**
 * One part of the recommendation snapshot (the Library, the candidate
 * catalog, the artist graph), read once and shared by everyone who asks
 * while Core's `snapshotAsk` keeps it. A write never cancels the read under
 * way: those already waiting take its answer, and whoever asks after the
 * write waits for the next read, which starts once that one ends. Kept free
 * of Expo so it runs under plain Node tests.
 */
import {
  snapshotAsk,
  type SnapshotPart,
  type SnapshotReadState,
  type SnapshotVersions,
} from "@wave/core";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { withRecommendationDeadline } from "./recommendationTimeout.ts";

/** A snapshot part, read by whoever asks while it's kept. */
export interface SnapshotRead<A, R> {
  /**
   * The part: read the first time it's asked for (with the services of
   * whoever asked), then shared until one of its sources is written or it
   * goes unused (`snapshotAsk`). A failed read isn't kept: the next ask
   * reads again. A read every waiter gave up on is cancelled.
   */
  readonly get: Effect.Effect<A, unknown, R>;
  /** Last completed value, even while a newer read derives; never starts work. */
  readonly peek: () => A | null;
  /** Cancels work and releases waiters permanently. */
  readonly dispose: () => void;
}

/**
 * [read] as the snapshot's [part], kept while the sources' [versions] (the
 * writes counted so far) are those it started at, as [now] tells the time.
 */
export const snapshotRead = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  {
    part,
    versions,
    now = Date.now,
  }: {
    readonly part: SnapshotPart;
    readonly versions: () => SnapshotVersions;
    readonly now?: () => number;
  },
): SnapshotRead<A, R> => {
  type Entry = SnapshotReadState & {
    versions: SnapshotVersions | null;
    done: boolean;
    usedAt: number;
    answer: Promise<A>;
    readonly controller: AbortController;
    users: number;
  };
  let latest: Entry | null = null;
  let completed: A | null = null;
  /** Every read not yet ended, the one under way and any queued after it, for `dispose`. */
  const outstanding = new Set<Entry>();
  let disposed = false;
  /** A read started now, or once [before] ends: it reads the sources as they are when it starts. */
  const entryOf = (context: Context.Context<R>, before: Entry | null, at: number): Entry => {
    const controller = new AbortController();
    const entry: Entry = {
      versions: null,
      done: false,
      usedAt: at,
      answer: Promise.resolve(undefined as A),
      controller,
      users: 0,
    };
    const start = () => {
      if (controller.signal.aborted) return Promise.reject(new Error("Snapshot read cancelled"));
      entry.versions = versions();
      return Effect.runPromiseWith(context)(read, { signal: controller.signal });
    };
    entry.answer = before === null ? start() : before.answer.then(start, start);
    outstanding.add(entry);
    void entry.answer.then(
      (value) => {
        if (!disposed) completed = value;
        outstanding.delete(entry);
        entry.done = true;
        entry.usedAt = Math.max(entry.usedAt, now());
      },
      () => {
        outstanding.delete(entry);
        entry.done = true;
        if (latest === entry) latest = null;
      },
    );
    return entry;
  };
  const get = Effect.gen(function* () {
    if (disposed) return yield* Effect.fail(new Error("Snapshot read disposed"));
    const context = yield* Effect.context<R>();
    const at = now();
    const ask = snapshotAsk(part, latest, versions(), at);
    if (ask !== "share" || latest === null)
      latest = entryOf(context, ask === "read-after" ? latest : null, at);
    const entry = latest;
    entry.usedAt = Math.max(entry.usedAt, at);
    entry.users++;
    const answer = yield* Effect.result(
      Effect.tryPromise({ try: () => entry.answer, catch: (cause) => cause }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          entry.users--;
          if (entry.users === 0 && !entry.done) {
            if (latest === entry) latest = null;
            entry.controller.abort();
          }
        }),
      ),
    );
    if (disposed) return yield* Effect.fail(new Error("Snapshot read disposed"));
    if (Result.isSuccess(answer)) return answer.success;
    return yield* Effect.fail(answer.failure);
  }).pipe(withRecommendationDeadline);
  return {
    get,
    peek: () => completed,
    dispose: () => {
      disposed = true;
      completed = null;
      latest = null;
      for (const entry of outstanding) entry.controller.abort();
      outstanding.clear();
    },
  };
};
