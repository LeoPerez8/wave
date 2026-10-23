/**
 * Scan reconciliation: turns what a library scan found into changes to the
 * index. Track identity is the file path, so a file that moved or was renamed
 * would otherwise look like one song removed and another added; matching it
 * (same size + duration + title + artist) to an indexed file the scan no
 * longer finds keeps its row, and with it the play history and favorite.
 *
 * Scans stream their results in batches. The scanner reports the indexed files
 * it no longer finds before any batch, so each batch is reconciled against the
 * files still unmatched after the previous one; whatever stays unmatched when
 * the scan completes is removed.
 */

import { identityKey } from "./library.ts";

/** What a file is recognised by when its path changes. */
export interface IndexedFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  /** As Wave stores it (Core's `normalizeTrack`). */
  readonly title: string;
  readonly artist: string;
}

export interface ScanReconcileInput<T extends IndexedFile> {
  /** Indexed files the scan didn't find that no earlier batch matched. */
  readonly missing: readonly IndexedFile[];
  /** Files the scanner read in this batch: new, changed or moved. */
  readonly read: readonly T[];
  /** Whether a path is in the index (counting the changes of earlier batches). */
  readonly isIndexed: (path: string) => boolean;
}

export interface TrackMove<T> {
  /** The indexed path the file was found under before. */
  readonly from: string;
  readonly to: T;
}

export interface ScanChanges<T> {
  /** Files new to the library. */
  readonly added: readonly T[];
  /** Indexed files that changed in place. */
  readonly updated: readonly T[];
  /** Indexed files found under a new path. */
  readonly moved: readonly TrackMove<T>[];
  /** Missing files no file in this batch matched; removed once the scan completes. */
  readonly unmatched: readonly IndexedFile[];
}

const signature = (file: IndexedFile): string =>
  [file.sizeBytes, file.durationMs, identityKey(file.title), identityKey(file.artist)].join(
    "\u0000",
  );

/** Reconciles one batch of a scan; see the module comment. */
export const reconcileScan = <T extends IndexedFile>(
  input: ScanReconcileInput<T>,
): ScanChanges<T> => {
  const candidates = new Map<string, IndexedFile[]>();
  for (const file of input.missing) {
    const key = signature(file);
    candidates.set(key, [...(candidates.get(key) ?? []), file]);
  }
  const added: T[] = [];
  const updated: T[] = [];
  const moved: TrackMove<T>[] = [];
  for (const file of input.read) {
    if (input.isIndexed(file.path)) {
      updated.push(file);
      continue;
    }
    const match = candidates.get(signature(file))?.shift();
    if (match === undefined) added.push(file);
    else moved.push({ from: match.path, to: file });
  }
  const matched = new Set(moved.map((move) => move.from));
  return {
    added,
    updated,
    moved,
    unmatched: input.missing.filter((file) => !matched.has(file.path)),
  };
};

/**
 * What a scan does last, from the files it [saved], the indexed files
 * [gone], whether playlists' entries changed since they were last linked
 * ([entriesChanged]: a sync or an import brought YT Music entries, or no
 * link ran yet in this process), and whether a scanned folder had never
 * finished a scan before ([firstScan]).
 */
export interface ScanEnd {
  /**
   * Turn playlists' YT Music entries into the Library songs they are. It
   * reads every entry and every song, so only when either side changed.
   */
  readonly linkEntries: boolean;
  /**
   * What screens are told: `removed` (songs left, every screen re-reads at
   * once), `added` (taken as a burst), `scanned` (a folder's first scan
   * found nothing: only the folder list, which shows whether a folder was
   * scanned, re-reads), or nothing when the scan changed nothing, the usual
   * rescan on return.
   */
  readonly announce: "added" | "removed" | "scanned" | null;
}

export const scanEnd = ({
  saved,
  gone,
  entriesChanged,
  firstScan,
}: {
  readonly saved: number;
  readonly gone: number;
  readonly entriesChanged: boolean;
  readonly firstScan: boolean;
}): ScanEnd => ({
  linkEntries: saved > 0 || entriesChanged,
  announce: gone > 0 ? "removed" : saved > 0 ? "added" : firstScan ? "scanned" : null,
});

/**
 * Files a scan batch's slice saves per transaction: the scanner hands over
 * up to 500 at once, and saving them in one go holds the JavaScript thread
 * for as long. Measured in docs/performance/315-startup-scheduling.md.
 */
export const SCAN_SAVE_SLICE = 100;

/** One transaction's worth of a scan batch: its files, and the moves to them. */
export interface ScanSaveSlice<T> {
  readonly tracks: readonly T[];
  /** Applied before the slice's files are saved, so a moved file keeps its row. */
  readonly moves: readonly { readonly from: string; readonly to: string }[];
}

/**
 * Splits what [changes] saves into slices of at most [size] files (added,
 * then updated, then moved), each carrying the moves to its own files, in
 * the batch's order. Each slice stands alone: a scan stopped between slices
 * leaves the rest unsaved, and the next scan reads those files again.
 */
export const scanSaveSlices = <T extends IndexedFile>(
  changes: ScanChanges<T>,
  size: number = SCAN_SAVE_SLICE,
): ScanSaveSlice<T>[] => {
  const tracks = [...changes.added, ...changes.updated, ...changes.moved.map((move) => move.to)];
  const movedFrom = new Map(changes.moved.map((move) => [move.to, move.from]));
  const slices: ScanSaveSlice<T>[] = [];
  for (let start = 0; start < tracks.length; start += Math.max(1, size)) {
    const slice = tracks.slice(start, start + Math.max(1, size));
    slices.push({
      tracks: slice,
      moves: slice.flatMap((track) => {
        const from = movedFrom.get(track);
        return from === undefined ? [] : [{ from, to: track.path }];
      }),
    });
  }
  return slices;
};

/** Same reconciliation, with a resumable boundary per input file. */
export function* reconcileScanSteps<T extends IndexedFile>(
  input: ScanReconcileInput<T>,
): Generator<void, ScanChanges<T>> {
  const candidates = new Map<string, { files: IndexedFile[]; next: number }>();
  for (const file of input.missing) {
    const key = signature(file);
    const group = candidates.get(key) ?? { files: [], next: 0 };
    group.files.push(file);
    candidates.set(key, group);
    yield;
  }
  const added: T[] = [];
  const updated: T[] = [];
  const moved: TrackMove<T>[] = [];
  for (const file of input.read) {
    if (input.isIndexed(file.path)) {
      updated.push(file);
      yield;
      continue;
    }
    const group = candidates.get(signature(file));
    const match = group?.files[group.next++];
    if (match === undefined) added.push(file);
    else moved.push({ from: match.path, to: file });
    yield;
  }
  const matched = new Set<string>();
  for (const move of moved) {
    matched.add(move.from);
    yield;
  }
  const unmatched: IndexedFile[] = [];
  for (const file of input.missing) {
    if (!matched.has(file.path)) unmatched.push(file);
    yield;
  }
  return {
    added,
    updated,
    moved,
    unmatched,
  };
}
