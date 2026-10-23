import { TAB_PATH } from "@wave/core";
import { router } from "@/lib/timingRouter";
import { useEffect } from "react";

/**
 * Search opened with a query from elsewhere (an unavailable playlist entry's
 * Search). The query waits for the screen when opening Search is what brings
 * it up, and reaches it straight away when it's already mounted (a kept tab).
 */

/** A query no screen has taken yet, or null. */
let pending: string | null = null;
const listeners = new Set<(query: string) => void>();

/** Opens the Search tab searching for [query]. */
export function openSearch(query: string): void {
  if (listeners.size === 0) pending = query;
  else {
    pending = null;
    for (const listener of listeners) listener(query);
  }
  router.navigate(TAB_PATH.search);
}

/** Calls [onQuery] with each query Search is opened with, a pending one first. */
export function useSearchRequests(onQuery: (query: string) => void): void {
  useEffect(() => {
    const taken = pending;
    pending = null;
    if (taken !== null) onQuery(taken);
    listeners.add(onQuery);
    return () => {
      listeners.delete(onQuery);
    };
  }, [onQuery]);
}
