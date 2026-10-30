/**
 * Voice notes and recordings a scan leaves out of the Library (docs/spec.md,
 * "First run and library"; Core's `isVoiceNoteOrRecording`), kept with the
 * size and date the scan found so the next scan passes over them unread, as
 * it does an indexed file that hasn't changed. This phone only, never synced.
 */
import { and, inArray, isNotNull, sql } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { CreditSplits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { removeTracks } from "./missingSongs.ts";
import * as schema from "./schema.ts";

/** A file a scan left out, as the scan found it. */
export interface SkippedFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
}

/** The skipped files under [roots]. */
export const selectSkippedFiles = (
  db: LibraryDatabase,
  roots: readonly string[],
): SkippedFile[] => {
  if (roots.length === 0) return [];
  const { skippedFiles } = schema;
  const under = roots.map(
    (root) => sql`substr(${skippedFiles.path}, 1, length(${root}) + 1) = ${`${root}/`}`,
  );
  return db
    .select({
      path: skippedFiles.path,
      sizeBytes: skippedFiles.sizeBytes,
      modifiedAt: skippedFiles.modifiedAt,
    })
    .from(skippedFiles)
    .where(sql.join(under, sql` OR `))
    .all();
};

/**
 * Leaves [files] out of the Library: a song indexed at one of their paths
 * goes as Remove from Library takes it (`removeTracks`), its star and playlist
 * entries with it and, signed in, out of the Wave account, so it never stays
 * as a missing song; its plays stay. Each file is kept as skipped. Returns how
 * many songs left.
 */
export const skipFiles = (
  db: LibraryDatabase,
  splits: CreditSplits,
  files: readonly SkippedFile[],
  now: number,
): number => {
  if (files.length === 0) return 0;
  const { tracks, skippedFiles } = schema;
  return db.transaction((tx) => {
    const ids = chunks(files.map((file) => file.path)).flatMap((paths) =>
      tx
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(isNotNull(tracks.path), inArray(tracks.path, paths)))
        .all()
        .map((row) => row.id),
    );
    removeTracks(tx, splits, ids, now);
    for (const some of chunks(files)) {
      tx.insert(skippedFiles)
        .values([...some])
        .onConflictDoUpdate({
          target: skippedFiles.path,
          set: {
            sizeBytes: sql`excluded.size_bytes`,
            modifiedAt: sql`excluded.modified_at`,
          },
        })
        .run();
    }
    return ids.length;
  });
};

/** Forgets the skipped files at [paths]: gone from the phone, or music after all. */
export const unskipFiles = (db: LibraryDatabase, paths: readonly string[]): void => {
  for (const some of chunks(paths)) {
    db.delete(schema.skippedFiles).where(inArray(schema.skippedFiles.path, some)).run();
  }
};
