import { requestGeniusLyricsSearch } from "@wave/client/geniusLyricsSearch";
import {
  geniusLyricsSearchRequest,
  settleGeniusLyricsSearch,
  type GeniusLyricsSearchState,
} from "@wave/core";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useGeniusInsightsEnabled } from "@/settings/genius";
import { online, subscribeConnectivity } from "@/native/waveNative";
import { askWaveService } from "@/sync/askWaveService";
import { useWaveSignedIn } from "@/sync/waveSignedIn";

/**
 * Asks once each time a 3+ word query pauses; old replies never replace the current query.
 * A query naming the song Search shows on top by its title and artist ([namesSong]) asks nothing.
 * A Library re-read (a scan batch, a play count) asks nothing again: the answer is kept, and
 * Search's rows leave out the hits a Lyrics row now shows (`resultRows`).
 */
export const useGeniusLyricsSearch = (
  query: string,
  libraryReady: boolean,
  namesSong = false,
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
    const request = geniusLyricsSearchRequest(query, enabled, namesSong);
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
  }, [query, libraryReady, namesSong, enabled, signedIn, isOnline, retryCount]);

  const request = geniusLyricsSearchRequest(query, enabled, namesSong);
  let current: GeniusLyricsSearchState;
  if (!enabled) current = { query, status: "disabled" };
  else if (request === null || signedIn === null || !libraryReady)
    current = { query, status: "idle" };
  else if (!isOnline) current = { query, status: "offline" };
  else if (!signedIn) current = { query, status: "signedOut" };
  else current = state.query === query ? state : { query, status: "idle" };
  return { state: current, retry };
};
