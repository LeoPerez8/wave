import * as Effect from "effect/Effect";
import { useEffect, useSyncExternalStore } from "react";

import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { makeExternalStore } from "@/lib/externalStore";

/** The recent searches, newest first; null until read from the store. */
const recent = makeExternalStore<readonly string[] | null>(null);

const run = (effect: Effect.Effect<readonly string[] | void, unknown, LibraryStore>): void => {
  void appRuntime
    .runPromise(effect)
    .then((list) => {
      if (list !== undefined) recent.set(list);
    })
    .catch(() => {
      // Recent searches are a convenience; a failed write keeps the list on screen as it was.
    });
};

// oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
const load = (): void => run(LibraryStore.use((store) => store.listRecentSearches));

/** Keeps a search (on submit, or when a result is opened). */
export const rememberSearch = (query: string): void =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  run(LibraryStore.use((store) => store.rememberSearch(query)));

export const clearRecentSearches = (): void => {
  recent.set([]);
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  run(LibraryStore.use((store) => store.clearRecentSearches));
};

/** The recent searches, newest first (empty until they've been read). */
export const useRecentSearches = (): readonly string[] => {
  const list = useSyncExternalStore(recent.subscribe, recent.get);
  useEffect(() => {
    if (recent.get() === null) load();
  }, []);
  return list ?? NONE;
};

const NONE: readonly string[] = [];
