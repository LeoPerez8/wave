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
