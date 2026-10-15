import {
  normalizeTrack,
  planAddRoot,
  planExclusion,
  reconcileScan,
  type IndexedFile,
} from "@wave/core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { refreshDownloadPolicy } from "./downloadPolicy";
import * as Stream from "effect/Stream";

import { makeExternalStore } from "@/lib/externalStore";
import { argbToHex, type NativeArtwork, type NativeScannedTrack } from "@/native/waveNative";

import type { ArtworkPalette } from "./db/schema";
import { LibraryStore, type IndexedArtwork, type IndexedTrack } from "./LibraryStore";
import { NativeScanner, type ScanEvent } from "./NativeScanner";

export type ScanState =
  | { readonly status: "idle" }
  | {
      readonly status: "scanning";
      /**
       * `full` when nothing under the scanned roots was indexed yet (the first
       * scan, a new folder); `incremental` when only changes need reading.
       */
      readonly kind: "full" | "incremental";
      readonly phase: "discovering" | "reading";
      readonly filesFound: number;
      /** Files whose tags were read so far. */
      readonly filesRead: number;
      /** Found files already indexed as they are, which aren't read again. */
      readonly filesUnchanged: number;
    }
  | { readonly status: "done"; readonly filesFound: number }
  | { readonly status: "failed"; readonly message: string };

/** Progress of the current or last scan, for the Library banner. */
export const scanState = makeExternalStore<ScanState>({ status: "idle" });

/** Bumped after every batch is committed, so lists know to re-query. */
export const libraryVersion = makeExternalStore(0);

const bumpLibraryVersion = (): void => libraryVersion.update((version) => version + 1);

/** Bumped when the owner changes the library (deletes songs): lists re-query at once. */
export const libraryEdits = makeExternalStore(0);

/** The owner changed the library outside a scan: every list re-queries straight away. */
export const libraryEdited = (): void => {
  libraryEdits.update((edits) => edits + 1);
  bumpLibraryVersion();
};

/** A track as the scanner read it, as the index stores it. */
export const toIndexedTrack = (native: NativeScannedTrack): IndexedTrack => ({
  ...normalizeTrack(native),
  sizeBytes: native.sizeBytes,
  modifiedAt: native.modifiedAt,
  sampleRate: native.sampleRate,
  bitrateKbps: native.bitrateKbps,
  artworkHash: native.artworkHash,
  hasLyrics: native.hasLyrics,
});

export const toIndexedArtwork = (native: NativeArtwork): IndexedArtwork => {
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

/**
 * Scans [roots] against the index: only new and changed files are read, moved
 * and renamed files keep their rows (Core's `reconcileScan`), and indexed files
 * the scan no longer finds are removed once it completes.
 */
const scanFolders = (roots: readonly string[]) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const scanner = yield* NativeScanner;
    // Without access the folders look empty, and every song would be removed as missing.
    if (!(yield* scanner.hasAllFilesAccess)) return;
    const excluded = yield* store.excludedFolders;
    const known = yield* store.knownFiles(roots);
    const kind = known.length === 0 ? "full" : "incremental";
    const indexed = new Set(known.map((file) => file.path));
    // Indexed files the scan didn't find that no batch has matched yet.
    let missing: readonly IndexedFile[] = [];
    const startedAt = Date.now();
    scanState.set({
      status: "scanning",
      kind,
      phase: "discovering",
      filesFound: 0,
      filesRead: 0,
      filesUnchanged: 0,
    });

    const handleEvent = (event: ScanEvent) =>
      Effect.gen(function* () {
        switch (event._tag) {
          case "Progress":
            scanState.set({
              status: "scanning",
              kind,
              phase: event.phase,
              filesFound: event.filesFound,
              filesRead: event.filesRead,
              filesUnchanged: event.filesUnchanged,
            });
            return;
          case "Missing":
            missing = yield* store.indexedFiles(event.paths);
            return;
          case "Batch": {
            const changes = reconcileScan({
              missing,
              read: event.tracks.map(toIndexedTrack),
              isIndexed: (path) => indexed.has(path),
            });
            missing = changes.unmatched;
            yield* store.saveBatch(
              [...changes.added, ...changes.updated, ...changes.moved.map((move) => move.to)],
              event.artwork.map(toIndexedArtwork),
              changes.moved.map((move) => ({ from: move.from, to: move.to.path })),
              // Linked once, against the whole Library, when the scan ends.
              { linkEntries: false },
            );
            for (const track of changes.added) indexed.add(track.path);
            for (const move of changes.moved) {
              indexed.delete(move.from);
              indexed.add(move.to.path);
            }
            bumpLibraryVersion();
            return;
          }
          case "Complete":
            return;
        }
      });

    // Assigned from the stream callback; the cast keeps TypeScript from narrowing it to undefined.
    let completed = undefined as Extract<ScanEvent, { _tag: "Complete" }> | undefined;
    yield* scanner.scan(roots, excluded, known).pipe(
      Stream.runForEach((event) => {
        if (event._tag === "Complete") completed = event;
        return handleEvent(event);
      }),
    );

    // Playlists' YT Music entries become the songs this scan (or one cut short) brought in.
    yield* store.linkPlaylistEntries;
    if (completed === undefined || completed.cancelled) {
      scanState.set({ status: "idle" });
      return;
    }
    // Also prunes albums and artists that changed tags left empty.
    yield* store.filesGone(missing.map((file) => file.path));
    yield* store.markScanned(roots, startedAt);
    bumpLibraryVersion();
    scanState.set({ status: "done", filesFound: completed.filesFound });
  });

/** Scans every scan root: in full the first time, incrementally afterwards. */
export const runRescan = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const scanner = yield* NativeScanner;
  const roots = yield* store.ensureDefaultRoot(yield* scanner.defaultMusicFolder);
  yield* scanFolders(roots.map((root) => root.path));
}).pipe(reportFailures);

/** Scans a newly added root. */
export const runFolderScan = (path: string) => scanFolders([path]).pipe(reportFailures);

export type FolderChoice =
  | { readonly kind: "added"; readonly path: string }
  /** The folder is already indexed through [by] (itself or a parent folder). */
  | { readonly kind: "covered"; readonly by: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unsupported" };

/** Lets the owner pick a folder and adds it as a root. The caller starts its scan. */
export const chooseFolder = Effect.gen(function* () {
  const scanner = yield* NativeScanner;
  const store = yield* LibraryStore;
  const pick = yield* scanner.pickFolder;
  if (pick.status !== "picked") return { kind: pick.status } satisfies FolderChoice;
  const plan = planAddRoot(yield* store.listRoots, pick.path);
  if (plan.kind === "covered") return plan satisfies FolderChoice;
  yield* store.addRoot(pick.path, plan.drop);
  yield* refreshDownloadPolicy;
  bumpLibraryVersion();
  return { kind: "added", path: pick.path } satisfies FolderChoice;
});

/** Removes a root and the songs only it covered. */
export const removeFolder = (path: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    yield* store.removeRoot(path);
    yield* refreshDownloadPolicy;
    bumpLibraryVersion();
  });

export type ExclusionChoice =
  | { readonly kind: "added"; readonly path: string }
  /** The folder isn't inside a music folder. */
  | { readonly kind: "outside" }
  /** The folder is a music folder itself. */
  | { readonly kind: "root" }
  /** The folder is already excluded through [by] (itself or a parent folder). */
  | { readonly kind: "covered"; readonly by: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unsupported" };

/** Lets the owner pick a folder to exclude. The caller starts the rescan that drops its songs. */
export const chooseExcludedFolder = Effect.gen(function* () {
  const scanner = yield* NativeScanner;
  const store = yield* LibraryStore;
  const pick = yield* scanner.pickFolder;
  if (pick.status !== "picked") return { kind: pick.status } satisfies ExclusionChoice;
  const roots = (yield* store.listRoots).map((root) => root.path);
  const plan = planExclusion(roots, yield* store.excludedFolders, pick.path);
  if (plan.kind !== "add") return plan satisfies ExclusionChoice;
  yield* store.addExcludedFolder(pick.path, plan.drop);
  yield* refreshDownloadPolicy;
  bumpLibraryVersion();
  return { kind: "added", path: pick.path } satisfies ExclusionChoice;
});

/** Stops excluding a folder. The caller starts the rescan that brings its songs back. */
export const includeFolder = (path: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    yield* store.removeExcludedFolder(path);
    yield* refreshDownloadPolicy;
    bumpLibraryVersion();
  });
