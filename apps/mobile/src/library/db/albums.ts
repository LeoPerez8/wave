/**
 * The album rows every album list reads (Library › Albums, artist and album
 * screens, Auto's Albums tab). Kept free of Expo so the store tests run it
 * against a real SQLite (`testDatabase.ts`).
 */
import { asc, eq, sql, type SQL } from "drizzle-orm";

import type { AlbumRow } from "../LibraryStore.ts";
import type { LibraryDatabase } from "./playHistory.ts";
import * as schema from "./schema.ts";

/** A window of a list: `limit` rows from `offset`. */
export interface RowPage {
  readonly offset: number;
  readonly limit: number;
}

/** The albums matching [where], by title, then album artist (the Library's order); [page] of them if given. */
export const selectAlbums = (
  db: LibraryDatabase,
  where: SQL | undefined,
  page?: RowPage,
): AlbumRow[] => {
  const { tracks, artists, albums, artwork } = schema;
  const query = db
    .select({
      id: albums.id,
      title: albums.title,
      titleSort: albums.titleSort,
      albumArtist: artists.name,
      albumArtistId: albums.albumArtistId,
      year: albums.year,
      compilation: albums.compilation,
      trackCount: sql<number>`count(${tracks.id})`,
      durationMs: sql<number>`coalesce(sum(${tracks.durationMs}), 0)`,
      thumbPath: artwork.thumbPath,
      artworkPath: artwork.path,
    })
    .from(albums)
    .innerJoin(artists, eq(albums.albumArtistId, artists.id))
    .innerJoin(tracks, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(albums.artworkHash, artwork.hash))
    .where(where)
    .groupBy(albums.id)
    .orderBy(asc(albums.titleSort), asc(artists.sort), asc(albums.id));
  return page === undefined ? query.all() : query.limit(page.limit).offset(page.offset).all();
};
