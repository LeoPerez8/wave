import { streamedCredits, type YtAlbumSong } from "@wave/core";
import { sql } from "drizzle-orm";

import { selectAlbums } from "./albums.ts";
import { selectArtists } from "./artists.ts";
import { readCredits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";

/** What Core's credit resolver matches streamed songs against: the Library's artists, albums and credits. */
export const playedLibraryRows = (db: LibraryDatabase, withAlbums = true) => ({
  artists: selectArtists(db, {}),
  albums: withAlbums ? selectAlbums(db, undefined) : [],
  credits: db
    .all<{ credit: string; stored: string | null }>(
      sql`
    SELECT DISTINCT artist_credit AS credit, artist_credits AS stored FROM tracks
    UNION SELECT album_artist_credit, album_artist_credits FROM albums`,
    )
    .flatMap(({ credit, stored }) => readCredits(credit, stored)),
});

export type PlayedLibraryRows = ReturnType<typeof playedLibraryRows>;

/** Core's credit resolver over [rows], knowing [releases]' release ids. */
export const playedResolver = (rows: PlayedLibraryRows, releases: Iterable<YtAlbumSong> = []) =>
  streamedCredits({ ...rows, releases });

/**
 * Metadata needed by Core's credit resolver, without reading play history.
 * Without [withAlbums] the Library's albums aren't read: a streamed song's
 * artists resolve the same, only its album goes unmatched.
 */
export const playedLibrary = (
  db: LibraryDatabase,
  releases: Iterable<YtAlbumSong> = [],
  withAlbums = true,
) => {
  const rows = playedLibraryRows(db, withAlbums);
  return { artists: rows.artists, albums: rows.albums, resolve: playedResolver(rows, releases) };
};
