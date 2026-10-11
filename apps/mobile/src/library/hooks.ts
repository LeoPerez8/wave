import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { WaveNative } from "@/native/waveNative";

import { libraryVersion, scanState, type ScanState } from "./LibraryScan";
import {
  LibraryStore,
  type LibraryStoreError,
  type ScanRootSummary,
  type SongRow,
} from "./LibraryStore";
import { appRuntime } from "./runtime";

export const useScanState = (): ScanState =>
  useSyncExternalStore(scanState.subscribe, scanState.get);

/**
 * Whether Wave holds all-files access. Re-checked whenever the app comes back
 * to the foreground, which is how a grant from system settings is noticed.
 */
export const useAllFilesAccess = (): {
  readonly granted: boolean;
  /** True once the user went to settings and came back without granting access. */
  readonly denied: boolean;
  readonly request: () => void;
} => {
  const [granted, setGranted] = useState(() => WaveNative.hasAllFilesAccess());
  const [denied, setDenied] = useState(false);
  const requested = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const now = WaveNative.hasAllFilesAccess();
      setGranted(now);
      if (requested.current && !now) setDenied(true);
      requested.current = false;
    });
    return () => subscription.remove();
  }, []);

  const request = useCallback(() => {
    requested.current = true;
    void WaveNative.requestAllFilesAccess();
  }, []);

  return { granted, denied, request };
};

const REQUERY_INTERVAL_MS = 1500;

/**
 * Runs a store query and re-runs it when scan batches land, at most every
 * 1.5 s so a large first scan doesn't re-query on every batch.
 */
const useLibraryQuery = <A>(
  query: Effect.Effect<A, LibraryStoreError, LibraryStore>,
  initial: A,
): A => {
  const [value, setValue] = useState(initial);
  const version = useSyncExternalStore(libraryVersion.subscribe, libraryVersion.get);
  const lastRun = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const run = () => {
      lastRun.current = Date.now();
      appRuntime
        .runPromise(query)
        .then((result) => {
          // A newer version may already be pending; this result is still the freshest one we have.
          if (mounted.current) setValue(result);
        })
        .catch(() => {
          // Keep showing the last good result; scan errors surface in the banner.
        });
    };
    const wait = lastRun.current + REQUERY_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      run();
      return undefined;
    }
    const timer = setTimeout(run, wait);
    return () => clearTimeout(timer);
  }, [query, version]);

  return value;
};

const listSongs = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return yield* store.listSongs;
});

const countTracks = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return yield* store.countTracks;
});

const NO_SONGS: readonly SongRow[] = [];

export const useSongs = (): readonly SongRow[] => useLibraryQuery(listSongs, NO_SONGS);

/** Number of tracks in the library, or null before the first count arrives. */
export const useTrackCount = (): number | null => useLibraryQuery<number | null>(countTracks, null);

const listRoots = Effect.gen(function* () {
  const store = yield* LibraryStore;
  return yield* store.listRoots;
});

const NO_ROOTS: readonly ScanRootSummary[] = [];

/** The music folders Wave indexes, with their song counts. */
export const useScanRoots = (): readonly ScanRootSummary[] => useLibraryQuery(listRoots, NO_ROOTS);
