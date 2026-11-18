/**
 * A playlist's own image: square files in Wave's storage that show in place
 * of its mosaic (`db/playlists.ts`), and the original photo they were framed
 * from, kept with the framing for Adjust Image. The image stays on this phone,
 * so none of this stamps the playlist: the Wave account never sees it. Each
 * edit hands back the files nothing shows or keeps any more, for the caller to
 * delete. Kept free of Expo so the store tests run it against a real SQLite
 * (`testDatabase.ts`).
 */
import { and, eq, isNotNull, or } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/**
 * An image's files: full size for the playlist's page, a thumbnail for lists,
 * and the original photo it was framed from, with the framing (Core's
 * `framingText`).
 */
export interface PlaylistImageFiles {
  readonly path: string;
  readonly thumbPath: string;
  readonly originalPath: string;
  readonly framing: string;
}

/** What Adjust Image reframes: the original photo and the last framing (null: none kept). */
export interface PlaylistImageOriginal {
  readonly originalPath: string;
  readonly framing: string | null;
}

const NO_IMAGE = {
  imagePath: null,
  imageThumbPath: null,
  imageOriginalPath: null,
  imageFraming: null,
} as const;

interface ImageRow {
  readonly imagePath: string | null;
  readonly imageThumbPath: string | null;
  readonly imageOriginalPath: string | null;
}

const imageColumns = {
  imagePath: schema.playlists.imagePath,
  imageThumbPath: schema.playlists.imageThumbPath,
  imageOriginalPath: schema.playlists.imageOriginalPath,
};

/** A row's files, each once (an image saved before originals were kept is its own). */
const filesOf = (row: ImageRow): string[] => [
  ...new Set(
    [row.imagePath, row.imageThumbPath, row.imageOriginalPath].filter((path) => path !== null),
  ),
];

const imageOf = (db: LibraryDatabase, id: number) =>
  db
    .select({
      ...imageColumns,
      imageFraming: schema.playlists.imageFraming,
      deleted: schema.playlists.deleted,
    })
    .from(schema.playlists)
    .where(eq(schema.playlists.id, id))
    .get();

/**
 * Gives a playlist [files] as its image. Hands back the files to delete: the
 * ones of the image it had that [files] doesn't keep (reframing keeps the
 * original), or [files] themselves when the playlist is gone.
 */
export const setPlaylistImage = (
  db: LibraryDatabase,
  id: number,
  files: PlaylistImageFiles,
): string[] =>
  db.transaction((tx) => {
    const kept = [files.path, files.thumbPath, files.originalPath];
    const before = imageOf(tx, id);
    if (before === undefined || before.deleted) return [...new Set(kept)];
    tx.update(schema.playlists)
      .set({
        imagePath: files.path,
        imageThumbPath: files.thumbPath,
        imageOriginalPath: files.originalPath,
        imageFraming: files.framing,
      })
      .where(eq(schema.playlists.id, id))
      .run();
    return filesOf(before).filter((path) => !kept.includes(path));
  });

/**
 * What Adjust Image reframes: the original photo and its framing, or, for an
 * image saved before originals were kept, the image itself with no framing.
 * Null when the playlist has no image (or is gone).
 */
export const selectPlaylistImageOriginal = (
  db: LibraryDatabase,
  id: number,
): PlaylistImageOriginal | null => {
  const row = imageOf(db, id);
  if (row === undefined || row.deleted || row.imagePath === null) return null;
  return row.imageOriginalPath === null
    ? { originalPath: row.imagePath, framing: null }
    : { originalPath: row.imageOriginalPath, framing: row.imageFraming };
};

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
 * Wave account), originals included, handed back once to delete: the
 * playlists keep no image.
 */
export const takeDeletedPlaylistImages = (db: LibraryDatabase): string[] =>
  db.transaction((tx) => {
    const { playlists } = schema;
    const gone = and(
      eq(playlists.deleted, true),
      or(
        isNotNull(playlists.imagePath),
        isNotNull(playlists.imageThumbPath),
        isNotNull(playlists.imageOriginalPath),
      ),
    );
    const rows = tx.select(imageColumns).from(playlists).where(gone).all();
    if (rows.length === 0) return [];
    tx.update(playlists).set(NO_IMAGE).where(gone).run();
    return rows.flatMap(filesOf);
  });
