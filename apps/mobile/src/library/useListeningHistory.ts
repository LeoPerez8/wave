import { useFocusEffect } from "expo-router";
import * as Effect from "effect/Effect";
import { useCallback, useRef, useState } from "react";

import type { ListeningHistoryPage } from "./db/listeningHistory";
import { onLibraryChange } from "./libraryChanges";
import { listeningHistoryReads, type ListeningHistoryRead } from "./listeningHistoryReads";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

const EMPTY: ListeningHistoryPage = { rows: [], next: null };

/** Pages history only while shown. Play progress refreshes its head; Library edits refresh loaded rows. */
export const useListeningHistory = (query = "") => {
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
        readPage: (before) =>
          appRuntime.runPromise(
            // oxlint-disable-next-line react/rules-of-hooks -- Effect resolves the store service.
            LibraryStore.use((store) => store.listeningHistory(before, query)),
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
    }, [query]),
  );

  return {
    rows:
      result.query === query ? result.page.rows : query === "" ? whole.current.rows : EMPTY.rows,
    loading: result.query !== query || loading,
    error,
    loadMore: useCallback(() => request.current("more"), []),
    refresh: useCallback(() => request.current("refresh"), []),
  };
};
