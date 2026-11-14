import {
  geniusLyricsCandidates,
  geniusLyricsSearchRequest,
  settleGeniusLyricsSearch,
  type GeniusLyricsSearchState,
} from "@wave/core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useGeniusInsightsEnabled } from "@/settings/genius";
import { online, subscribeConnectivity } from "@/native/waveNative";
import { askWaveService } from "@/sync/askWaveService";
import { useWaveSignedIn } from "@/sync/waveSignedIn";

const REQUEST_TIMEOUT_MS = 15_000;

/** The JSON response for a query, or an explicit no-request outcome. */
export interface GeniusLyricsSearchPorts {
  readonly enabled: boolean;
  readonly signedIn: boolean | null;
  readonly isOnline: () => boolean;
  readonly ask: (query: string) => Promise<unknown>;
}

/**
 * Requests a settled Genius state after policy checks; network errors remain distinct from offline.
 * Its hits are Genius's whole answer: Search's rows leave out the songs a Lyrics row shows.
 */
export const requestGeniusLyricsSearch = async (
  query: string,
  ports: GeniusLyricsSearchPorts,
): Promise<GeniusLyricsSearchState> => {
  const request = geniusLyricsSearchRequest(query, ports.enabled);
  if (!ports.enabled) return { query, status: "disabled" };
  if (request === null) return { query, status: "idle" };
  if (!ports.isOnline()) return { query, status: "offline" };
  if (ports.signedIn === null) return { query, status: "idle" };
  if (!ports.signedIn) return { query, status: "signedOut" };
  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      ports.ask(`/v1/genius/search?q=${encodeURIComponent(request.query)}`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Genius search timed out")),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });
    const hits = geniusLyricsCandidates(reply);
    return hits === null ? { query, status: "failed" } : { query, status: "hits", hits };
  } catch {
    return { query, status: ports.isOnline() ? "failed" : "offline" };
  }
};

/**
 * Asks once each time a 3+ word query pauses; old replies never replace the current query.
 * A Library re-read (a scan batch, a play count) asks nothing again: the answer is kept, and
 * Search's rows leave out the hits a Lyrics row now shows (`resultRows`).
 */
export const useGeniusLyricsSearch = (
  query: string,
  libraryReady: boolean,
): { readonly state: GeniusLyricsSearchState; readonly retry: () => void } => {
  const enabled = useGeniusInsightsEnabled();
  const signedIn = useWaveSignedIn();
  const isOnline = useSyncExternalStore(subscribeConnectivity, online);
  const [state, setState] = useState<GeniusLyricsSearchState>({ query: "", status: "idle" });
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => {
    setState({ query, status: "loading" });
    setRetryCount((count) => count + 1);
  }, [query]);
  useEffect(() => {
    const request = geniusLyricsSearchRequest(query, enabled);
    if (
      !enabled ||
      request === null ||
      signedIn === null ||
      !libraryReady ||
      !isOnline ||
      !signedIn
    )
      return undefined;

    let live = true;
    const timer = setTimeout(() => {
      const loading: GeniusLyricsSearchState = { query, status: "loading" };
      setState(loading);
      void requestGeniusLyricsSearch(query, {
        enabled,
        signedIn,
        isOnline: () => isOnline,
        ask: askWaveService,
      }).then((settled) => {
        if (!live) return;
        const answer =
          settled.status === "hits"
            ? { status: "hits" as const, hits: settled.hits }
            : settled.status === "signedOut" ||
                settled.status === "failed" ||
                settled.status === "offline"
              ? { status: settled.status }
              : { status: "failed" as const };
        setState((current) => settleGeniusLyricsSearch(current, query, answer));
      });
    }, request.delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, libraryReady, enabled, signedIn, isOnline, retryCount]);

  const request = geniusLyricsSearchRequest(query, enabled);
  let current: GeniusLyricsSearchState;
  if (!enabled) current = { query, status: "disabled" };
  else if (request === null || signedIn === null || !libraryReady)
    current = { query, status: "idle" };
  else if (!isOnline) current = { query, status: "offline" };
  else if (!signedIn) current = { query, status: "signedOut" };
  else current = state.query === query ? state : { query, status: "idle" };
  return { state: current, retry };
};
