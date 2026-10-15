/**
 * The album rows every album list reads (Library › Albums, artist and album
 * screens, Auto's Albums tab), and an album's screen. Kept free of Expo so the
 * store tests run it against a real SQLite (`testDatabase.ts`).
 */
import { compareAlbumTracks } from "@wave/core";
import { asc, desc, eq, sql, type SQL } from "drizzle-orm";

import type { AlbumDetail, AlbumRow } from "../LibraryStore.ts";
import type { LibraryDatabase, RowPage } from "./database.ts";
import * as schema from "./schema.ts";
import { albumArtistIds, inScope, trackQuery, type TrackScope } from "./tracks.ts";

/**
 * The albums matching [where] with Tracks in [scope], by title, then album
 * artist (the Library's order), each with its Tracks in [scope] counted;
 * [page] of them if given.
 */
export const selectAlbums = (
  db: LibraryDatabase,
  where: SQL | undefined,
  page?: RowPage,
  scope: TrackScope = "library",
): AlbumRow[] => {
  const { tracks, artists, albums, artwork } = schema;
  const query = db
    .select({
      id: albums.id,
      title: albums.title,
      titleSort: albums.titleSort,
      albumArtist: albums.albumArtistCredit,
      albumArtistId: albums.albumArtistId,
      albumArtistIds,
      year: albums.year,
      compilation: albums.compilation,
      trackCount: sql<number>`count(${tracks.id})`,
      durationMs: sql<number>`coalesce(sum(${tracks.durationMs}), 0)`,
      thumbPath: artwork.thumbPath,
      artworkPath: artwork.path,
    })
    .from(albums)
    .innerJoin(artists, eq(albums.albumArtistId, artists.id))
    .innerJoin(tracks, inScope(eq(tracks.albumId, albums.id), scope))
    .leftJoin(artwork, eq(albums.artworkHash, artwork.hash))
    .where(where)
    .groupBy(albums.id)
    .orderBy(asc(albums.titleSort), asc(artists.sort), asc(albums.id));
  return page === undefined ? query.all() : query.limit(page.limit).offset(page.offset).all();
};

/**
 * An album's screen: its row, its most common genre and its Tracks in
 * [scope] in album order; null when it has none (it's no longer in the Library).
 */
export const selectAlbumDetail = (
  db: LibraryDatabase,
  id: number,
  scope: TrackScope = "library",
): AlbumDetail | null => {
  const { tracks, genres } = schema;
  const album = selectAlbums(db, eq(schema.albums.id, id), undefined, scope)[0];
  if (album === undefined) return null;
  const genre = db
    .select({ name: genres.name })
    .from(tracks)
    .innerJoin(genres, eq(tracks.genreId, genres.id))
    .where(eq(tracks.albumId, id))
    .groupBy(genres.id)
    .orderBy(desc(sql`count(*)`), asc(genres.sort))
    .get();
  const rows = trackQuery(db, scope).where(eq(tracks.albumId, id)).all();
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  return { album, genre: genre?.name ?? null, tracks: rows.sort(compareAlbumTracks) };
};
