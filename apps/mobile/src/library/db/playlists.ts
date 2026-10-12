/**
 * The playlist rows the playlist screen and Auto's playlists read. Kept free
 * of Expo so the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import { asc, eq } from "drizzle-orm";

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
