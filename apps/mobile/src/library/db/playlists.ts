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
