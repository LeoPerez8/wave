/**
 * Files Wave must delete (`schema.fileDeletions`): recorded in the transaction
 * that made them leftovers (a quality replacement's old file once its Track
 * took the new one), deleted after it, and cleared once gone. A deletion cut
 * off by a kill is still here at the next launch, which finishes it. Kept free
 * of Expo for the store tests.
 */
import { eq, inArray } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** A database or a transaction on it: recording a deletion goes in the change's own. */
type Writer = Pick<LibraryDatabase, "insert">;

/** Records that the files [paths] must go, each once. */
export const recordFileDeletions = (db: Writer, paths: readonly string[], now: number): void => {
  for (const path of new Set(paths))
    db.insert(schema.fileDeletions).values({ path, recordedAt: now }).onConflictDoNothing().run();
};

/**
 * The files still recorded for deletion, oldest first. A file a Track holds
 * now is a Library song's, never deleted behind its back: its record goes.
 */
export const pendingFileDeletions = (db: LibraryDatabase): string[] =>
  db.transaction((tx) => {
    const recorded = tx
      .select({ path: schema.fileDeletions.path })
      .from(schema.fileDeletions)
      .orderBy(schema.fileDeletions.recordedAt, schema.fileDeletions.path)
      .all()
      .map((row) => row.path);
    const held = new Set<string>();
    for (const part of chunks(recorded))
      for (const row of tx
        .select({ path: schema.tracks.path })
        .from(schema.tracks)
        .where(inArray(schema.tracks.path, part))
        .all())
        if (row.path !== null) held.add(row.path);
    for (const path of held)
      tx.delete(schema.fileDeletions).where(eq(schema.fileDeletions.path, path)).run();
    return recorded.filter((path) => !held.has(path));
  });

/** Clears the records of the files [paths]: they're gone, or were never there. */
export const forgetFileDeletions = (db: LibraryDatabase, paths: readonly string[]): void => {
  if (paths.length === 0) return;
  db.transaction((tx) => {
    for (const part of chunks(paths))
      tx.delete(schema.fileDeletions).where(inArray(schema.fileDeletions.path, part)).run();
  });
};
