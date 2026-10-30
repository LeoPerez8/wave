import { registerTimingBackground, timingBackgroundChanged } from "@/lib/timing";
import {
  createLandings,
  explicitFromAdvisory,
  isVoiceNoteOrRecording,
  normalizeTrack,
  planAddRoot,
  planExclusion,
  scanEnd,
  type IndexedFile,
  type LibraryChange,
} from "@wave/core";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { refreshDownloadPolicy } from "./downloadPolicy";
import { finishFileDeletions } from "./fileDeletions";
import * as Stream from "effect/Stream";

import { runSteps } from "@/lib/stepped";
import { readScanIndex, saveScanBatch, finishScanIndex, skipVoiceNoteFiles } from "./startupJobs";

import { startupTurnEffect } from "@/lib/backgroundWork";
import { makeExternalStore } from "@/lib/externalStore";
import { argbToHex, type NativeArtwork, type NativeScannedTrack } from "@/native/waveNative";
import { skipVoiceNotes } from "@/settings/skipVoiceNotes";

import type { ArtworkPalette } from "./db/schema";
import type { SkippedFile } from "./db/skippedFiles";
import { publishLibraryChange, publishSavedStars } from "./libraryChanges";
import { LibraryStore, type IndexedArtwork, type IndexedTrack } from "./LibraryStore";
import { NativeScanner, type ScanEvent } from "./NativeScanner";
import { scanBatchChange } from "./scanChanges";

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
registerTimingBackground("scan", () => (scanState.get().status === "scanning" ? "scan" : null));
scanState.subscribe(timingBackgroundChanged);

/** Bumped after every batch is committed, so lists know to re-query. */
export const libraryVersion = makeExternalStore(0);

let editsVersion = 0;
/**
 * Moves with `libraryVersion` on every change but a download landing (a
 * deletion, an edit, a scan): downloads' clean-up runs on those mid-run.
 */
export const libraryEditsVersion = (): number => editsVersion;

/** Bumps `libraryVersion` and announces [changes] to shared queries; [landing]: downloads landed. */
const changeLibrary = (changes: readonly LibraryChange[], landing: boolean): void => {
  if (!landing) editsVersion++;
  libraryVersion.update((version) => version + 1);
  for (const change of changes) publishLibraryChange(change);
};

const bumpLibraryVersion = (...changes: readonly LibraryChange[]): void =>
  changeLibrary(changes, false);

const FOLDERS: LibraryChange = { kind: "folders" };
/** A scan's link turned playlists' streamed entries into Library songs. */
const ENTRIES_LINKED: LibraryChange = { kind: "playlists" };

/**
 * Playlists' entries' revision (`playlistEntriesRevision`) when a scan last
 * linked them; null until the first scan of this process links.
 */
let linkedAtRevision: number | null = null;

/**
 * The owner changed the library outside a scan (deleted songs, edited tags,
 * the Wave account sent changes): lists over tracks re-read straight away.
 * [trackIds]: the tracks changed, when known. A download landing is
 * `songsLanded`.
 */
export const libraryEdited = (trackIds?: readonly number[]): void => {
  bumpLibraryVersion(
    trackIds === undefined ? { kind: "tracks" } : { kind: "tracks", ids: trackIds },
  );
};

const landings = createLandings({
  schedule: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  announce: (change) => changeLibrary([change], true),
});

/**
 * Downloads landed Tracks [trackIds] in the Library (an import, a quality
 * replacement): lists hear of them together, as a burst naming them, at most
 * every 2 s, and at once for the run's [last] song or when the run ends (no
 * ids). [fillIn]: they wait for their fill-in (`songsFilledIn`), 2 s at most,
 * so a song and its fill-in are one change (Core's `createLandings`).
 */
export const songsLanded = (
  trackIds: readonly number[],
  options?: { readonly last?: boolean; readonly fillIn?: boolean },
): void => landings.land(trackIds, options);

/** The fill-in of downloaded Tracks [trackIds] is done; [wrote]: it changed them (Core's `Landings.filled`). */
export const songsFilledIn = (trackIds: readonly number[], options: { readonly wrote: boolean }) =>
  landings.filled(trackIds, options);

/** A track as the scanner read it, as the index stores it. */
export const toIndexedTrack = (native: NativeScannedTrack): IndexedTrack => ({
  ...normalizeTrack(native),
  sizeBytes: native.sizeBytes,
  modifiedAt: native.modifiedAt,
  sampleRate: native.sampleRate,
  bitrateKbps: native.bitrateKbps,
  artworkHash: native.artworkHash,
  hasLyrics: native.hasLyrics,
  explicit: explicitFromAdvisory(native.advisory),
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
 * the scan no longer finds are removed once it completes. With Skip voice notes
 * and recordings on, voice notes and recordings (Core's `isVoiceNoteOrRecording`)
 * stay out: indexed ones leave first, new ones are never saved, and either kind
 * is passed over unread by later scans while unchanged.
 */
const scanFolders = (roots: readonly string[]) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const scanner = yield* NativeScanner;
    // Without access the folders look empty, and every song would be removed as missing.
    if (!(yield* scanner.hasAllFilesAccess)) return;
    // Files recorded for deletion (a replaced song's old file) go first, at launch included;
    // one that couldn't be deleted is left out, so it never comes back as a second song.
    const undeleted = yield* finishFileDeletions("scan", { between: startupTurnEffect });
    const undeletedRecordedFiles =
      undeleted.length === 0
        ? new Set<string>()
        : yield* runSteps(
            (function* () {
              const files = new Set<string>();
              for (const path of undeleted) {
                files.add(path);
                yield;
              }
              return files;
            })(),
            startupTurnEffect,
          );
    yield* startupTurnEffect;
    const excluded = yield* store.excludedFolders;
    const skipping = skipVoiceNotes();
    const { known, indexed, skipped, scanKnown, left } = yield* readScanIndex(
      store,
      roots,
      startupTurnEffect,
      skipping,
    );
    // Voice notes indexed before (or before the switch went on) left the Library.
    if (left > 0) bumpLibraryVersion({ kind: "tracks" });
    const kind = known.length === 0 ? "full" : "incremental";
    // Music folders shows a folder no scan finished yet without its song count.
    yield* startupTurnEffect;
    const firstScan = yield* store.hasUnscannedRoot(roots);

    // Indexed files the scan didn't find that no batch has matched yet.
    let missing: readonly IndexedFile[] = [];
    /** Skipped files the scan didn't find, forgotten once it completes. */
    let skippedGone: readonly string[] = [];
    /** Files this scan saved (new, changed, moved). */
    let saved = 0;
    const savedTrackIds: number[] = [];
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
            yield* startupTurnEffect;
            missing = yield* store.indexedFiles(event.paths);
            if (skipped.size > 0) {
              skippedGone = yield* runSteps(
                (function* () {
                  const paths: string[] = [];
                  for (const path of event.paths) {
                    if (skipped.has(path)) paths.push(path);
                    yield;
                  }
                  return paths;
                })(),
                startupTurnEffect,
              );
            }
            return;
          case "Batch": {
            const { read, voiceNotes, music } = yield* runSteps(
              (function* () {
                const tracks: IndexedTrack[] = [];
                // Files left out as voice notes, and skipped files that turned out music.
                const notes: SkippedFile[] = [];
                const turnedMusic: string[] = [];
                for (const native of event.tracks) {
                  if (!undeletedRecordedFiles.has(native.path)) {
                    const track = toIndexedTrack(native);
                    if (skipping && isVoiceNoteOrRecording(track)) {
                      notes.push({
                        path: track.path,
                        sizeBytes: track.sizeBytes,
                        modifiedAt: track.modifiedAt,
                      });
                    } else {
                      tracks.push(track);
                      if (skipped.has(track.path)) turnedMusic.push(track.path);
                    }
                  }
                  yield;
                }
                return { read: tracks, voiceNotes: notes, music: turnedMusic };
              })(),
              startupTurnEffect,
            );
            if (voiceNotes.length > 0) {
              // An indexed file that changed into a voice note leaves with its song.
              const gone = yield* skipVoiceNoteFiles(store, voiceNotes, startupTurnEffect);
              for (const file of voiceNotes) {
                indexed.delete(file.path);
                skipped.add(file.path);
              }
              if (gone > 0) bumpLibraryVersion({ kind: "tracks" });
            }
            if (music.length > 0) {
              yield* startupTurnEffect;
              yield* store.unskipFiles(music);
              for (const path of music) skipped.delete(path);
            }
            const artwork = yield* runSteps(
              (function* () {
                const rows: IndexedArtwork[] = [];
                for (const row of event.artwork) {
                  rows.push(toIndexedArtwork(row));
                  yield;
                }
                return rows;
              })(),
              startupTurnEffect,
            );
            const {
              changes,
              count,
              ids: batchTrackIds,
            } = yield* saveScanBatch(
              store,
              { missing, read, isIndexed: (path) => indexed.has(path) },
              artwork,
              startupTurnEffect,
              ({ starred }) => publishSavedStars(starred),
            );
            missing = changes.unmatched;
            saved += count;
            savedTrackIds.push(...batchTrackIds);
            yield* runSteps(
              (function* () {
                for (const track of changes.added) {
                  indexed.add(track.path);
                  yield;
                }
                for (const move of changes.moved) {
                  indexed.delete(move.from);
                  indexed.add(move.to.path);
                  yield;
                }
              })(),
              startupTurnEffect,
            );
            if (count > 0) bumpLibraryVersion(scanBatchChange(batchTrackIds));
            return;
          }
          case "Complete":
            return;
        }
      });

    // Assigned from the stream callback; the cast keeps TypeScript from narrowing it to undefined.
    let completed = undefined as Extract<ScanEvent, { _tag: "Complete" }> | undefined;
    yield* startupTurnEffect;
    yield* scanner.scan(roots, excluded, scanKnown).pipe(
      Stream.runForEach((event) => {
        if (event._tag === "Complete") completed = event;
        return handleEvent(event);
      }),
    );

    const finished = completed !== undefined && !completed.cancelled;
    const end = scanEnd({
      saved,
      gone: finished ? missing.length : 0,
      entriesChanged: (yield* store.playlistEntriesRevision) !== linkedAtRevision,
      firstScan,
    });
    // Playlists' YT Music entries become the songs this scan (or one cut short) brought in,
    // or the Library songs entries that came meanwhile (a sync, an import) are.
    let linked = 0;
    if (end.linkEntries) {
      yield* startupTurnEffect;
      linked = yield* store.linkPlaylistEntries;
      linkedAtRevision = yield* store.playlistEntriesRevision;
    }
    if (completed === undefined || completed.cancelled) {
      if (linked > 0) bumpLibraryVersion(ENTRIES_LINKED);
      scanState.set({ status: "idle" });
      return;
    }
    // Also prunes albums and artists that changed tags left empty.
    const missingPaths =
      missing.length === 0
        ? []
        : yield* runSteps(
            (function* () {
              const paths: string[] = [];
              for (const file of missing) {
                paths.push(file.path);
                yield;
              }
              return paths;
            })(),
            startupTurnEffect,
          );
    yield* finishScanIndex(store, missingPaths, startupTurnEffect);
    if (skippedGone.length > 0) {
      yield* startupTurnEffect;
      yield* store.unskipFiles(skippedGone);
    }
    yield* startupTurnEffect;
    yield* store.markScanned(roots, startedAt);
    // Songs whose files are gone left the Library: every screen drops them now, hidden ones too.
    // A folder's first scan that found nothing has Music folders show it scanned ("0 songs").
    // A rescan that changed nothing (the usual return to Wave) has nobody re-read anything.
    if (end.announce === "removed") bumpLibraryVersion({ kind: "tracks" });
    else if (end.announce === "added") bumpLibraryVersion(scanBatchChange(savedTrackIds));
    else if (end.announce === "scanned" || linked > 0) {
      bumpLibraryVersion(
        ...(end.announce === "scanned" ? [FOLDERS] : []),
        ...(linked > 0 ? [ENTRIES_LINKED] : []),
      );
    }
    scanState.set({ status: "done", filesFound: completed.filesFound });
  });

/** Scans every scan root: in full the first time, incrementally afterwards. */
export const runRescan = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const scanner = yield* NativeScanner;
  yield* startupTurnEffect;
  const folder = yield* scanner.defaultMusicFolder;
  yield* startupTurnEffect;
  const roots = yield* store.ensureDefaultRoot(folder);
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
  // Its songs come with the scan the caller starts.
  bumpLibraryVersion(FOLDERS);
  return { kind: "added", path: pick.path } satisfies FolderChoice;
});

/** Removes a root and the songs only it covered. */
export const removeFolder = (path: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    yield* store.removeRoot(path);
    yield* refreshDownloadPolicy;
    // The songs only it covered went with it.
    bumpLibraryVersion(FOLDERS, { kind: "tracks" });
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
  bumpLibraryVersion(FOLDERS);
  return { kind: "added", path: pick.path } satisfies ExclusionChoice;
});

/** Stops excluding a folder. The caller starts the rescan that brings its songs back. */
export const includeFolder = (path: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    yield* store.removeExcludedFolder(path);
    yield* refreshDownloadPolicy;
    bumpLibraryVersion(FOLDERS);
  });
