/** A desktop scan uses the phone's save and leaving-song rules over Core's reconciliation. */
import {
  reconcileScan,
  scanFileState,
  scanPathKey,
  scanPathWithin,
  type IndexedFile,
  type ScanFolder,
} from "@wave/core";
import { isNotNull } from "drizzle-orm";
import type { IndexedTrack } from "../types.ts";
import type { LibraryDatabase } from "./database.ts";
import { creditSplits } from "./credits.ts";
import { saveBatch, pruneOrphans } from "./save.ts";
import { leaveFiles } from "./missingSongs.ts";
import { linkPlaylistEntries } from "./playlists.ts";
import { tracks, skippedFiles } from "./schema.ts";
import { skipFiles, unskipFiles, type SkippedFile } from "./skippedFiles.ts";

export const desktopScanIndex = (db: LibraryDatabase, platform: string) => {
  const splits = creditSplits();
  let known = new Map<string, ReturnType<typeof read>[number]>();
  let missing: readonly IndexedFile[] = [];
  let folders: readonly ScanFolder[] = [];
  let changed = false;
  const read = () =>
    db
      .select({
        path: tracks.path,
        sizeBytes: tracks.sizeBytes,
        modifiedAt: tracks.modifiedAt,
        durationMs: tracks.durationMs,
        title: tracks.title,
        artist: tracks.artistCredit,
      })
      .from(tracks)
      .where(isNotNull(tracks.path))
      .all()
      .map((row) => ({ ...row, path: row.path! }));
  return {
    /** Read once per scan, also used to avoid reading unchanged tags. */
    known: read,
    skipped: () => db.select().from(skippedFiles).all(),
    skip: (files: readonly SkippedFile[]) => {
      skipFiles(db, splits, files, Date.now());
      const paths = new Set(files.map((file) => scanPathKey(file.path, platform)));
      missing = missing.filter((file) => !paths.has(scanPathKey(file.path, platform)));
    },
    begin: (roots: readonly ScanFolder[], seenPaths: readonly string[]) => {
      folders = roots;
      const seen = new Set(seenPaths.map((path) => scanPathKey(path, platform)));
      const rows = read();
      known = new Map(rows.map((row) => [scanPathKey(row.path, platform), row]));
      missing = rows.filter((row) => scanFileState(row.path, roots, seen, platform) === "missing");
      changed = false;
    },
    save: (batch: readonly IndexedTrack[]) => {
      const changes = reconcileScan({
        missing,
        read: batch,
        isIndexed: (path) => known.has(scanPathKey(path, platform)),
      });
      const moves = changes.moved.map((move) => ({ from: move.from, to: move.to.path }));
      for (const track of changes.updated) {
        const from = known.get(scanPathKey(track.path, platform))!.path;
        if (from !== track.path) moves.push({ from, to: track.path });
      }
      saveBatch(db, splits, batch, [], moves, Date.now(), { linkEntries: false });
      unskipFiles(
        db,
        batch.map((track) => track.path),
      );
      missing = changes.unmatched;
      changed ||= batch.length > 0;
      for (const track of batch) known.set(scanPathKey(track.path, platform), track);
    },
    finish: (latestRoots: readonly ScanFolder[] = folders) => {
      folders = latestRoots;
      missing = missing.filter(
        (file) => scanFileState(file.path, folders, new Set(), platform) === "missing",
      );
      db.transaction((tx) => {
        if (missing.length > 0) {
          leaveFiles(
            tx,
            missing.map((row) => row.path),
            Date.now(),
          );
          pruneOrphans(tx, splits);
        }
        if (changed) linkPlaylistEntries(tx, Date.now());
      });
    },
    unavailable: (path: string) =>
      folders.some((root) => scanPathWithin(path, root.path, platform)) &&
      !folders.some((root) => root.available && scanPathWithin(path, root.path, platform)),
  };
};
