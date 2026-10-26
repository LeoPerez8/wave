import { useFocusEffect } from "expo-router";
import * as Effect from "effect/Effect";
import { useCallback, useRef, useState } from "react";

import type { ListeningHistoryPage } from "./db/listeningHistory";
import { onLibraryChange } from "./libraryChanges";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

const EMPTY: ListeningHistoryPage = { rows: [], next: null };
type Read = "more" | "head" | "refresh";

/** Pages history only while shown. Play progress refreshes its head; Library edits refresh loaded rows. */
export const useListeningHistory = () => {
  const [page, setPage] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const shown = useRef(EMPTY);
  const request = useRef<(read: Read) => void>(() => {});

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let busy = false;
      let pending: Read | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const readPage = (before?: ListeningHistoryPage["next"]) =>
        appRuntime.runPromise(
          // oxlint-disable-next-line react/rules-of-hooks -- Effect resolves the store service.
          LibraryStore.use((store) => store.listeningHistory(before ?? undefined)),
        );
      const run = async (read: Read): Promise<void> => {
        if (!active) return;
        if (busy) {
          if (read !== "more") pending = pending === "refresh" ? pending : read;
          return;
        }
        if (read === "more" && shown.current.next === null) return;
        busy = true;
        setLoading(true);
        setError(false);
        try {
          const previous = shown.current;
          let result = await readPage(read === "more" ? previous.next : undefined);
          if (read === "refresh") {
            // Yield between pages when a Library edit revalidates a long, already opened list.
            while (result.next !== null && result.rows.length < previous.rows.length) {
              await new Promise((resolve) => setTimeout(resolve, 0));
              if (!active) return;
              const next = await readPage(result.next);
              result = { rows: [...result.rows, ...next.rows], next: next.next };
            }
          } else if (
            read === "more" ||
            result.rows.some((row) => previous.rows.some((old) => old.id === row.id))
          ) {
            // Keep the previous boundary and overlapping head rows: inserting a new play cannot leave a gap.
            const byId = new Map(previous.rows.map((row) => [row.id, row]));
            for (const row of result.rows) byId.set(row.id, row);
            result = {
              rows: [...byId.values()].toSorted((a, b) => b.startedAt - a.startedAt || b.id - a.id),
              next: read === "more" ? result.next : previous.next,
            };
          }
          if (active) {
            shown.current = result;
            setPage(result);
          }
        } catch {
          if (active) setError(true);
        } finally {
          busy = false;
          if (active) {
            setLoading(false);
            if (pending !== null) {
              const next = pending;
              pending = null;
              clearTimeout(timer);
              timer = undefined;
              void run(next);
            }
          }
        }
      };
      request.current = (read) => void run(read);
      void run("refresh");
      const schedule = (read: Read, delay: number): void => {
        pending = pending === "refresh" ? pending : read;
        if (timer !== undefined) return;
        timer = setTimeout(() => {
          timer = undefined;
          const next = pending;
          pending = null;
          if (next !== null) void run(next);
        }, delay);
      };
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
        clearTimeout(timer);
        request.current = () => {};
      };
    }, []),
  );

  return {
    rows: page.rows,
    loading,
    error,
    loadMore: useCallback(() => request.current("more"), []),
    refresh: useCallback(() => request.current("refresh"), []),
  };
};
