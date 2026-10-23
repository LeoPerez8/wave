/** Production startup work, with injectable free turns for desktop work-count/clock tests. */
import {
  finishPlaylistImportSteps,
  libraryImportFinderSteps,
  unsearchedSongJob,
  reconcileScanSteps,
  replacementDuplicatesSteps,
  replacementDuplicateFixSteps,
  scanSaveSlices,
  SCAN_SAVE_SLICE,
  type ScanReconcileInput,
  type DuplicateOutcome,
  type PendingFavorite,
  type ReplacementDuplicate,
  type PlaylistImport,
  type YtAlbumSong,
  type YtLibraryFavorites,
  type YtSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { runSteps } from "../lib/stepped.ts";
import type { IndexedArtwork, IndexedTrack, LibraryStore } from "./LibraryStore.ts";

/**
 * Rows one startup write takes: ti's scan save slice. A turn holds one such
 * transaction, so a long list costs a turn per hundred rows, not per row.
 */
const STARTUP_WRITE_ROWS = SCAN_SAVE_SLICE;

const slices = <A>(rows: readonly A[]): A[][] => {
  const parts: A[][] = [];
  for (let start = 0; start < rows.length; start += STARTUP_WRITE_ROWS)
    parts.push(rows.slice(start, start + STARTUP_WRITE_ROWS));
  return parts;
};

/**
 * Appends the import's songs a 100-song transaction per turn (ti appended them in one);
 * a resumed import's held songs are skipped by the append itself.
 */
export const finishLinkImport = (
  store: LibraryStore["Service"],
  job: PlaylistImport<YtAlbumSong>,
  turn: Effect.Effect<void>,
  current: () => boolean = () => true,
  saved: () => void = () => {},
) =>
  Effect.gen(function* () {
    const finished = yield* runSteps(finishPlaylistImportSteps(job), turn);
    for (const songs of slices(finished.songs)) {
      yield* turn;
      if (!current()) return null;
      yield* store.addToPlaylist(job.playlistId, songs);
      saved();
    }
    return current() ? finished.job : null;
  });

/**
 * Liked Songs' stars, then (after the synced stars' downloads) its pending
 * favorites, a 100-row write per turn, then its downloads in one request, in
 * ti's order. False when [current] says the read left the batch meanwhile.
 */
export const dispatchLibraryFavorites = async <S extends YtSong>(
  favorites: YtLibraryFavorites<S>,
  ports: {
    readonly turn: () => Promise<void>;
    readonly current: () => boolean;
    readonly star: (trackIds: readonly number[]) => Promise<void>;
    readonly syncedStars: () => void;
    readonly pend: (favorites: readonly PendingFavorite[]) => Promise<void>;
    readonly download: (songs: readonly S[]) => void;
  },
): Promise<boolean> => {
  for (const ids of slices(favorites.star)) {
    await ports.turn();
    if (!ports.current()) return false;
    await ports.star(ids);
  }
  // A liked song the Library has only as a missing song downloads, as any new star does.
  ports.syncedStars();
  // Before any download is queued, so each one's landing finds its pending favorite.
  for (const pending of slices(favorites.pending)) {
    await ports.turn();
    if (!ports.current()) return false;
    await ports.pend(pending);
  }
  if (favorites.download.length > 0) {
    await ports.turn();
    if (!ports.current()) return false;
    // One request: the download service reads its journal once for the whole list.
    ports.download(favorites.download);
  }
  return true;
};

/** Source SQLite read is indivisible; building the membership index yields per file. */
export const readScanIndex = (
  store: LibraryStore["Service"],
  roots: readonly string[],
  turn: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    yield* turn;
    const known = yield* store.knownFiles(roots);
    const indexed = yield* runSteps(
      (function* () {
        const paths = new Set<string>();
        for (const file of known) {
          paths.add(file.path);
          yield;
        }
        return paths;
      })(),
      turn,
    );
    return { known, indexed };
  });

/**
 * Reconciliation in steps, then ti's save slices (100 files, the batch's
 * artwork with the first) as one transaction per turn.
 */
export const saveScanBatch = (
  store: LibraryStore["Service"],
  input: ScanReconcileInput<IndexedTrack>,
  artwork: readonly IndexedArtwork[],
  turn: Effect.Effect<void>,
  saved: (batch: {
    readonly starred: readonly number[];
    readonly trackIds: readonly number[];
  }) => void = () => {},
) =>
  Effect.gen(function* () {
    const changes = yield* runSteps(reconcileScanSteps(input), turn);
    const parts = scanSaveSlices(changes);
    // New artwork alone (files that were read but saved nothing) still gets saved.
    if (parts.length === 0 && artwork.length > 0) parts.push({ tracks: [], moves: [] });
    let count = 0;
    const ids: number[] = [];
    for (const [index, slice] of parts.entries()) {
      yield* turn;
      const result = yield* store.saveBatch(
        slice.tracks,
        // Before any file that shows it.
        index === 0 ? artwork : [],
        slice.moves,
        { linkEntries: false },
      );
      saved(result);
      ids.push(...result.trackIds);
      count += slice.tracks.length;
    }
    return { changes, count, ids };
  });

/** Pair source SQL and one pair's native audio read/atomic history merge are indivisible. */
export const checkDuplicateFiles = (
  store: LibraryStore["Service"],
  turn: Effect.Effect<void>,
  lengths: (paths: readonly string[]) => Effect.Effect<readonly (number | null)[], unknown>,
) =>
  Effect.gen(function* () {
    yield* turn;
    const files = yield* store.duplicateCheckFiles;
    const pairs = yield* runSteps(replacementDuplicatesSteps(files), turn);
    const outcomes: { pair: ReplacementDuplicate; outcome: DuplicateOutcome }[] = [];
    const changed: number[] = [];
    for (const pair of pairs) {
      yield* turn;
      const read = yield* lengths([pair.old.path, pair.new.path]);
      yield* turn;
      const fix = yield* runSteps(
        replacementDuplicateFixSteps(pair, { old: read[0] ?? null, new: read[1] ?? null }),
        turn,
      );
      yield* turn;
      if (fix.kind === "leave") {
        outcomes.push({ pair, outcome: fix });
        continue;
      }
      const fixed = yield* store.fixReplacementDuplicate(fix);
      outcomes.push({ pair, outcome: fixed ? fix : { kind: "leave", reason: "changed" } });
      if (fixed) changed.push(fix.keep.id, fix.drop.id);
    }
    return { outcomes, changed };
  });

/** Build the three native scanner columns in budgeted CPU steps, before its indivisible bridge call. */
export const scanInputColumns = (
  known: readonly { path: string; sizeBytes: number; modifiedAt: number }[],
  turn: Effect.Effect<void>,
) =>
  runSteps(
    (function* () {
      const paths: string[] = [],
        sizes: number[] = [],
        modified: number[] = [];
      for (const file of known) {
        paths.push(file.path);
        sizes.push(file.sizeBytes);
        modified.push(file.modifiedAt);
        yield;
      }
      return { paths, sizes, modified };
    })(),
    turn,
  );

/**
 * A completed scan's cleanup, as on ti: the files gone, then the albums, credits and
 * artist images that saves left (a download's included). The store skips it when
 * nothing was written since its last one.
 */
export const finishScanIndex = (
  store: LibraryStore["Service"],
  missing: readonly string[],
  turn: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    yield* turn;
    yield* store.filesGone(missing);
  });

/** A filled import prepares Library membership before handing entries to the download service. */
export const readImportDownloadInput = (
  store: LibraryStore["Service"],
  playlistId: number,
  turn: Effect.Effect<void>,
  current: () => boolean = () => true,
) =>
  Effect.gen(function* () {
    yield* turn;
    if (!current()) return null;
    const detail = yield* store.getPlaylist(playlistId);
    if (detail === null || detail.items.length === 0) return null;
    yield* turn;
    if (!current()) return null;
    const library = yield* store.listSongs;
    const find = yield* runSteps(libraryImportFinderSteps(library), turn);
    const matched = yield* runSteps(
      (function* () {
        const ids = new Set<string>();
        for (const entry of detail.items) {
          if (entry.source !== "library") {
            const song = entry.source === "stream" ? entry.song : unsearchedSongJob(entry.song);
            if ((yield* find(song)) !== null) ids.add(song.videoId);
          }
          yield;
        }
        return ids;
      })(),
      turn,
    );
    yield* turn;
    return current()
      ? { detail, inLibrary: (song: { readonly videoId: string }) => matched.has(song.videoId) }
      : null;
  });
