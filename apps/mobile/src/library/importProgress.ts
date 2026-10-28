/**
 * Where each importing playlist stands (docs/spec.md, "Importing playlists
 * from a link", Progress; Core's `importProgress`): Waiting, Reading,
 * Matching with Library, Adding, then its live count again. Waiting comes
 * from the kept batch (`ytLibraryBatch`, with each playlist's expected
 * count), so it shows the same after Wave starts again; the phases past it
 * live on a board while Wave runs, set by the batch's reads
 * (`ytLibraryImport.ts`) and the link imports giving playlists their songs
 * (`playlistImports.ts`). Rows and pages read one playlist's entry, which
 * keeps its identity while it doesn't change, so a long list draws again
 * only the rows whose line moved.
 */
import {
  clearImportProgress,
  importBatchLine,
  importProgressByPlaylist,
  NO_IMPORT_PROGRESS,
  setImportProgress,
  type ImportBatchLine,
  type ImportProgress,
  type ImportProgressBoard,
  type YtLibraryBatch,
} from "@wave/core";
import { useSyncExternalStore } from "react";

import { makeExternalStore, subscribeAll } from "@/lib/externalStore";

import { playlistImports } from "./playlistImportsStore";
import { ytLibraryBatch, ytLibraryBatchPause } from "./ytLibraryBatchStore";

/** The live phases past waiting, by playlist id. */
const board = makeExternalStore<ImportProgressBoard>(NO_IMPORT_PROGRESS);

/** [playlistId]'s import is at [progress] now (never backwards: Core's `setImportProgress`). */
export const showImportProgress = (playlistId: number, progress: ImportProgress): void =>
  board.update((current) => setImportProgress(current, playlistId, progress));

/** [playlistId]'s import is done, ended, or starts over from Waiting. */
export const endImportProgress = (playlistId: number): void =>
  board.update((current) => clearImportProgress(current, playlistId));

let cached: {
  readonly batch: YtLibraryBatch;
  readonly board: ImportProgressBoard;
  readonly all: ReadonlyMap<number, ImportProgress>;
} | null = null;

/** Every importing playlist's progress, by playlist id; the same map while nothing changed. */
export const importProgressNow = (): ReadonlyMap<number, ImportProgress> => {
  const batch = ytLibraryBatch.get();
  const live = board.get();
  if (cached !== null && cached.batch === batch && cached.board === live) return cached.all;
  const all = importProgressByPlaylist(batch, live, cached?.all);
  cached = { batch, board: live, all };
  return all;
};

/** Calls [listener] whenever any playlist's progress may have changed; gives the function that stops it. */
export const subscribeImportProgress = subscribeAll(board, ytLibraryBatch);

/** [playlistId]'s import progress; null when it isn't importing, so its live count shows. */
export const useImportProgress = (playlistId: number): ImportProgress | null =>
  useSyncExternalStore(subscribeImportProgress, () => importProgressNow().get(playlistId) ?? null);

let batchLine: ImportBatchLine | null = null;

/**
 * The batch's line at the top of Playlists (Core's `importBatchLine`), from
 * the kept batch and link imports, so Wave starting again doesn't step it
 * back; the same object while what it says doesn't change, so a page or a
 * slice added draws it again only when its count moves.
 */
const importBatchLineNow = (): ImportBatchLine | null => {
  const next = importBatchLine(
    ytLibraryBatch.get(),
    playlistImports.get(),
    ytLibraryBatchPause.get(),
  );
  if (next?.text !== batchLine?.text || next?.paused !== batchLine?.paused) batchLine = next;
  return batchLine;
};

const subscribeImportBatch = subscribeAll(playlistImports, ytLibraryBatch, ytLibraryBatchPause);

/** "Importing playlists · 12 of 80", "Import paused · offline", or null with no batch importing. */
export const useImportBatchLine = (): ImportBatchLine | null =>
  useSyncExternalStore(subscribeImportBatch, importBatchLineNow);
