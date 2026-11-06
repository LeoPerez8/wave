import type { DatedRelease, LogLevel } from "@wave/core";
import * as Effect from "effect/Effect";

import { makeExternalStore, type ExternalStore } from "../lib/externalStore.ts";

/** What Version History has read of the channel's history, in this JS runtime. */
export interface VersionHistoryState {
  readonly status: "idle" | "loading" | "loaded" | "failed";
  /**
   * The last list read, or the one the phone kept from an earlier run; it stays while a read is on
   * its way and after one fails. Null while nothing was ever read.
   */
  readonly releases: readonly DatedRelease[] | null;
}

export interface VersionHistoryStoreOptions {
  /** The channel's whole history from the update service. */
  readonly fetchHistory: () => Effect.Effect<readonly DatedRelease[], unknown>;
  /** The last list read, kept on the phone across runs of Wave; each read that answers replaces it. */
  readonly kept: {
    readonly read: () => readonly DatedRelease[] | null;
    readonly write: (releases: readonly DatedRelease[]) => void;
  };
  readonly log: (level: LogLevel, message: string) => void;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The channel's history for Settings' row and the Version History page. It starts from the list the
 * phone kept, read when first asked for. `load` reads the service, and an answer replaces the list
 * and what's kept. A failure goes to the log and leaves the state `failed`, with the list it had,
 * until the next `load` (Try Again).
 */
export const createVersionHistoryStore = ({
  fetchHistory,
  kept,
  log,
}: VersionHistoryStoreOptions) => {
  let made: ExternalStore<VersionHistoryState> | null = null;
  const theStore = (): ExternalStore<VersionHistoryState> =>
    (made ??= makeExternalStore<VersionHistoryState>({ status: "idle", releases: kept.read() }));

  const load = (): void => {
    const store = theStore();
    if (store.get().status === "loading") return;
    store.update((state) => ({ ...state, status: "loading" }));
    void Effect.runPromise(
      fetchHistory().pipe(
        Effect.map((releases) => {
          store.set({ status: "loaded", releases });
          kept.write(releases);
        }),
        Effect.catch((error) =>
          Effect.sync(() => {
            log("warn", `The version history fetch failed: ${reason(error)}`);
            store.update((state) => ({ ...state, status: "failed" }));
          }),
        ),
      ),
    );
  };

  return {
    get: () => theStore().get(),
    subscribe: (listener: () => void) => theStore().subscribe(listener),
    load,
  };
};
