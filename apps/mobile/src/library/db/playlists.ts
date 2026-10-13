/**
 * The playlist rows the playlist screen and Auto's playlists read. Kept free
 * of Expo so the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import type { LibraryDatabase, RowPage } from "./database.ts";
import * as schema from "./schema.ts";
import { songColumns } from "./tracks.ts";

/**
 * A playlist's songs in playlist order, each with its playlist item (a song
 * can be in it more than once); [page] of them if given.
 */
export const selectPlaylistSongs = (db: LibraryDatabase, playlistId: number, page?: RowPage) => {
  const { playlistItems, tracks, artists, albums, artwork } = schema;
  const query = db
    .select({ ...songColumns, itemId: playlistItems.id })
    .from(playlistItems)
    .innerJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(eq(playlistItems.playlistId, playlistId))
    .orderBy(asc(playlistItems.position), asc(playlistItems.id));
  return page === undefined ? query.all() : query.limit(page.limit).offset(page.offset).all();
};

/** Every track's id and file path, for matching an imported playlist's entries (Core's `libraryPathIndex`). */
export const selectTrackPaths = (db: LibraryDatabase) =>
  db.select({ id: schema.tracks.id, path: schema.tracks.path }).from(schema.tracks).all();

/** Rows per insert, well under SQLite's limit on bound values. */
const INSERT_CHUNK = 200;

/** Inserts playlist entries [rows] (any number), in inserts of a size SQLite takes. */
export const insertPlaylistItems = (
  db: LibraryDatabase,
  rows: readonly (typeof schema.playlistItems.$inferInsert)[],
): void => {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    db.insert(schema.playlistItems)
      .values(rows.slice(i, i + INSERT_CHUNK))
      .run();
  }
};

/**
 * Makes a playlist hold exactly [trackIds], in that order (an import's
 * Replace): the same playlist, so its name and place stay.
 */
export const replacePlaylistSongs = (
  db: LibraryDatabase,
  playlistId: number,
  trackIds: readonly number[],
  now: number,
): void => {
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    tx.delete(playlistItems).where(eq(playlistItems.playlistId, playlistId)).run();
    const rows = trackIds.map((trackId, position) => ({
      playlistId,
      trackId,
      position,
      addedAt: now,
    }));
    insertPlaylistItems(tx, rows);
    tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, playlistId)).run();
  });
};

/**
 * Removes the given entries from a playlist in one go (each entry on its own,
 * so another copy of the same song stays); ids from other playlists are ignored.
 */
export const removePlaylistItems = (
  db: LibraryDatabase,
  playlistId: number,
  itemIds: readonly number[],
  now: number,
): void => {
  if (itemIds.length === 0) return;
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    tx.delete(playlistItems)
      .where(and(eq(playlistItems.playlistId, playlistId), inArray(playlistItems.id, [...itemIds])))
      .run();
    tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, playlistId)).run();
  });
};
