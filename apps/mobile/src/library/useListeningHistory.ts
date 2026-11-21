import { useFocusEffect } from "expo-router";
import * as Effect from "effect/Effect";
import { useCallback, useRef, useState } from "react";

import { listeningHistoryReads, type ListeningHistoryRead } from "@wave/core";
import type { ListeningHistoryPage } from "@wave/client/db/listeningHistory";
import { onLibraryChange } from "./libraryChanges";
import { LibraryStore } from "./LibraryStore";

import { appRuntime } from "./runtime";

const EMPTY: ListeningHistoryPage = { rows: [], next: null, newer: null };

/** At most this many plays of the history's head are kept for its next opening. */
export const HISTORY_KEPT_ROWS = 100;

/**
 * The whole history's head as last read, kept for the session so Settings ›
 * History opens on it (#1352) and reads again in place; `readyScreens.ts`
 * reads it at startup. Only a head page (nothing newer) of at most
 * `HISTORY_KEPT_ROWS` plays is kept.
 */
let keptHead: ListeningHistoryPage = EMPTY;

const keepHead = (page: ListeningHistoryPage): void => {
  if (page.newer === null && page.rows.length <= HISTORY_KEPT_ROWS) keptHead = page;
};

/** Reads the history's newest page into what its next opening draws. */
export const readListeningHistoryHead = (): Promise<void> =>
  appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    .runPromise(LibraryStore.use((store) => store.listeningHistory(undefined, "")))
    .then(keepHead);

/**
 * Pages history only while shown. Play progress refreshes its head; Library
 * edits refresh loaded rows. Opened at the play [around] (Go to This Moment),
 * the full history starts with the plays around it; a search starts at the newest.
 */
export const useListeningHistory = (query = "", around?: number) => {
  // Opened on the newest plays, it starts from the head kept for the session.
  const opening = query === "" && around === undefined ? keptHead : EMPTY;
  const [result, setResult] = useState({ query, page: opening });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const whole = useRef(opening);
  const shown = useRef({ query, page: opening });
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
          if (query === "") {
            whole.current = result;
            if (around === undefined) keepHead(result);
          }
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
