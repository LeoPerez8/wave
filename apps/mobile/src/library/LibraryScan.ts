import { normalizeTrack } from "@wave/core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { makeExternalStore } from "@/lib/externalStore";
import { argbToHex, type NativeArtwork, type NativeScannedTrack } from "@/native/waveNative";

import type { ArtworkPalette } from "./db/schema";
import { LibraryStore, unscannedRoots, type IndexedArtwork, type IndexedTrack } from "./LibraryStore";
import { NativeScanner, type ScanEvent } from "./NativeScanner";

export type ScanState =
  | { readonly status: "idle" }
  | {
      readonly status: "scanning";
      readonly phase: "discovering" | "reading";
      readonly filesFound: number;
      readonly filesRead: number;
    }
  | { readonly status: "done"; readonly filesFound: number }
  | { readonly status: "failed"; readonly message: string };

/** Progress of the current or last scan, for the Library banner. */
export const scanState = makeExternalStore<ScanState>({ status: "idle" });

/** Bumped after every batch is committed, so lists know to re-query. */
export const libraryVersion = makeExternalStore(0);

const toIndexedTrack = (native: NativeScannedTrack): IndexedTrack => ({
  ...normalizeTrack(native),
  sizeBytes: native.sizeBytes,
  modifiedAt: native.modifiedAt,
  sampleRate: native.sampleRate,
  bitrateKbps: native.bitrateKbps,
  artworkHash: native.artworkHash,
});

const toIndexedArtwork = (native: NativeArtwork): IndexedArtwork => {
  const palette: Record<string, string> = {};
  for (const [name, argb] of Object.entries(native.palette)) {
    if (typeof argb === "number") palette[name] = argbToHex(argb);
  }
  return {
    hash: native.hash,
    path: native.path,
    thumbPath: native.thumbPath,
    palette: palette as ArtworkPalette,
  };
};

const handleEvent = (event: ScanEvent) =>
  Effect.gen(function* () {
    switch (event._tag) {
      case "Progress":
        scanState.set({
          status: "scanning",
          phase: event.phase,
          filesFound: event.filesFound,
          filesRead: event.filesRead,
        });
        return;
      case "Batch": {
        const store = yield* LibraryStore;
        yield* store.saveBatch(event.tracks.map(toIndexedTrack), event.artwork.map(toIndexedArtwork));
        libraryVersion.update((version) => version + 1);
        return;
      }
      case "Complete":
        return;
    }
  });

/** Shows a failed scan in the banner instead of failing the fiber; an interruption just resets it. */
const reportFailures = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A | void, never, R> =>
  self.pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        if (Cause.hasInterruptsOnly(cause)) {
          scanState.set({ status: "idle" });
          return;
        }
        const error = Cause.squash(cause);
        scanState.set({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }),
    ),
  );

/** Runs a full scan of the scan roots and stores the results batch by batch. */
export const runFullScan = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const scanner = yield* NativeScanner;
  const roots = yield* store.ensureDefaultRoot(yield* scanner.defaultMusicFolder);
  const excluded = yield* store.excludedFolders;
  const startedAt = Date.now();
  scanState.set({ status: "scanning", phase: "discovering", filesFound: 0, filesRead: 0 });

  // Assigned from the stream callback; the cast keeps TypeScript from narrowing it to undefined.
  let completed = undefined as Extract<ScanEvent, { _tag: "Complete" }> | undefined;
  yield* scanner
    .scan(
      roots.map((root) => root.path),
      excluded,
    )
    .pipe(
      Stream.runForEach((event) => {
        if (event._tag === "Complete") completed = event;
        return handleEvent(event);
      }),
    );

  if (completed === undefined || completed.cancelled) {
    scanState.set({ status: "idle" });
    return;
  }
  yield* store.markScanned(
    roots.map((root) => root.path),
    startedAt,
  );
  scanState.set({ status: "done", filesFound: completed.filesFound });
}).pipe(reportFailures);

/**
 * Starts the first full scan when a scan root has never finished one (first
 * launch, or a first scan that was interrupted). Rescans on later launches
 * come with incremental scanning.
 */
export const runInitialScanIfNeeded = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const scanner = yield* NativeScanner;
  const roots = yield* store.ensureDefaultRoot(yield* scanner.defaultMusicFolder);
  if (unscannedRoots(roots).length === 0) {
    scanState.set({ status: "done", filesFound: yield* store.countTracks });
    return;
  }
  yield* runFullScan;
}).pipe(reportFailures);
