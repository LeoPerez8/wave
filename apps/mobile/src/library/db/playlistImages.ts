/**
 * A playlist's own image: square files in Wave's storage that show in place
 * of its mosaic (`db/playlists.ts`). The image stays on this phone, so none of
 * this stamps the playlist: the Wave account never sees it. Each edit hands
 * back the files nothing shows any more, for the caller to delete. Kept free
 * of Expo so the store tests run it against a real SQLite (`testDatabase.ts`).
 */
import { and, eq, isNotNull, or } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** An image's two files: full size for the playlist's page, a thumbnail for lists. */
export interface PlaylistImageFiles {
  readonly path: string;
  readonly thumbPath: string;
}

const NO_IMAGE = { imagePath: null, imageThumbPath: null } as const;

const filesOf = (row: {
  readonly imagePath: string | null;
  readonly imageThumbPath: string | null;
}): string[] => [row.imagePath, row.imageThumbPath].filter((path) => path !== null);

const imageOf = (db: LibraryDatabase, id: number) => {
  const { playlists } = schema;
  return db
    .select({
      imagePath: playlists.imagePath,
      imageThumbPath: playlists.imageThumbPath,
      deleted: playlists.deleted,
    })
    .from(playlists)
    .where(eq(playlists.id, id))
    .get();
};

/**
 * Gives a playlist [files] as its image. Hands back the files to delete: the
 * image it had, or [files] themselves when the playlist is gone.
 */
export const setPlaylistImage = (
  db: LibraryDatabase,
  id: number,
  files: PlaylistImageFiles,
): string[] =>
  db.transaction((tx) => {
    const before = imageOf(tx, id);
    if (before === undefined || before.deleted) return [files.path, files.thumbPath];
    tx.update(schema.playlists)
      .set({ imagePath: files.path, imageThumbPath: files.thumbPath })
      .where(eq(schema.playlists.id, id))
      .run();
    return filesOf(before);
  });

/** Takes a playlist's image away, so its mosaic shows again; hands back its files to delete. */
export const removePlaylistImage = (db: LibraryDatabase, id: number): string[] =>
  db.transaction((tx) => {
    const before = imageOf(tx, id);
    if (before === undefined) return [];
    tx.update(schema.playlists).set(NO_IMAGE).where(eq(schema.playlists.id, id)).run();
    return filesOf(before);
  });

/**
 * The image files of deleted playlists (here or on another phone, through the
 * Wave account), handed back once to delete: the playlists keep no image.
 */
export const takeDeletedPlaylistImages = (db: LibraryDatabase): string[] =>
  db.transaction((tx) => {
    const { playlists } = schema;
    const gone = and(
      eq(playlists.deleted, true),
      or(isNotNull(playlists.imagePath), isNotNull(playlists.imageThumbPath)),
    );
    const rows = tx
      .select({ imagePath: playlists.imagePath, imageThumbPath: playlists.imageThumbPath })
      .from(playlists)
      .where(gone)
      .all();
    if (rows.length === 0) return [];
    tx.update(playlists).set(NO_IMAGE).where(gone).run();
    return rows.flatMap(filesOf);
  });
