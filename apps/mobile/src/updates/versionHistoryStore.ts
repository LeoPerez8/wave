import type { DatedRelease, LogLevel } from "@wave/core";
import * as Effect from "effect/Effect";

import { makeExternalStore } from "../lib/externalStore.ts";

/** What Version History has read of the channel's history, in this JS runtime. */
export interface VersionHistoryState {
  readonly status: "idle" | "loading" | "loaded" | "failed";
  /** The last list read; it stays while a read is on its way. Null before the first one answers. */
  readonly releases: readonly DatedRelease[] | null;
}

export interface VersionHistoryStoreOptions {
  /** The channel's whole history, newest first; a cache can stand in front of the service here. */
  readonly fetchHistory: () => Effect.Effect<readonly DatedRelease[], unknown>;
  readonly log: (level: LogLevel, message: string) => void;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The channel's history for Settings' row and the Version History page: `load` reads it, and a
 * failure goes to the log and leaves the state `failed` until the next `load` (Try Again).
 */
export const createVersionHistoryStore = ({ fetchHistory, log }: VersionHistoryStoreOptions) => {
  const store = makeExternalStore<VersionHistoryState>({ status: "idle", releases: null });

  const load = (): void => {
    if (store.get().status === "loading") return;
    store.update((state) => ({ ...state, status: "loading" }));
    void Effect.runPromise(
      fetchHistory().pipe(
        Effect.map((releases) => store.set({ status: "loaded", releases })),
        Effect.catch((error) =>
          Effect.sync(() => {
            log("warn", `The version history fetch failed: ${reason(error)}`);
            store.update((state) => ({ ...state, status: "failed" }));
          }),
        ),
      ),
    );
  };

  return { get: store.get, subscribe: store.subscribe, load };
};
