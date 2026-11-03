import { useFocusEffect } from "expo-router";
import * as Effect from "effect/Effect";
import { useCallback, useRef, useState } from "react";

import type { ListeningHistoryPage } from "./db/listeningHistory";
import { onLibraryChange } from "./libraryChanges";
import { listeningHistoryReads, type ListeningHistoryRead } from "./listeningHistoryReads";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

const EMPTY: ListeningHistoryPage = { rows: [], next: null, newer: null };

/**
 * Pages history only while shown. Play progress refreshes its head; Library
 * edits refresh loaded rows. Opened at the play [around] (Go to This Moment),
 * the full history starts with the plays around it; a search starts at the newest.
 */
export const useListeningHistory = (query = "", around?: number) => {
  const [result, setResult] = useState({ query, page: EMPTY });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const whole = useRef(EMPTY);
  const shown = useRef({ query, page: EMPTY });
  const request = useRef<(read: ListeningHistoryRead) => void>(() => {});

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const reads = listeningHistoryReads({
        initial:
          shown.current.query === query ? shown.current.page : query === "" ? whole.current : EMPTY,
        around: query === "" ? around : undefined,
        readPage: (from) =>
          appRuntime.runPromise(
            // oxlint-disable-next-line react/rules-of-hooks -- Effect resolves the store service.
            LibraryStore.use((store) =>
              "around" in from
                ? store.listeningHistoryAround(from.around)
                : "after" in from
                  ? store.newerListeningHistory(from.after)
                  : store.listeningHistory(from.before, query),
            ),
          ),
        onPage: (result) => {
          shown.current = { query, page: result };
          if (query === "") whole.current = result;
          setResult({ query, page: result });
        },
        onLoading: setLoading,
        onError: setError,
      });
      const { schedule } = reads;
      request.current = reads.request;
      reads.request("refresh");
      const stop = onLibraryChange(({ kind }) => {
        if (kind === "tracks") schedule("refresh", 0);
        else if (kind === "plays") schedule("head", 1500);
      });
      // Progress writes cross the counted threshold before a play ends; they don't publish a plays change.
      let stopProgress: (() => void) | undefined;
      void appRuntime
        .runPromise(
          // oxlint-disable-next-line react/rules-of-hooks -- Effect resolves the store service.
          LibraryStore.use((store) =>
            Effect.sync(() => {
              if (active)
                stopProgress = store.listeningHistoryVersion.subscribe(() =>
                  schedule("head", 1500),
                );
            }),
          ),
        )
        .catch(() => {});
      return () => {
        active = false;
        stop();
        stopProgress?.();
        reads.stop();
        request.current = () => {};
      };
    }, [query, around]),
  );

  const page = result.query === query ? result.page : query === "" ? whole.current : EMPTY;
  return {
    rows: page.rows,
    /** Plays newer than those shown are still to read, above them. */
    newer: page.newer !== null,
    loading: result.query !== query || loading,
    error,
    loadMore: useCallback(() => request.current("more"), []),
    loadNewer: useCallback(() => request.current("newer"), []),
    refresh: useCallback(() => request.current("refresh"), []),
  };
};
