/**
 * What a Library artist's page and an album's hero read beyond the songs table
 * (docs/spec.md, "Artist page"): the artist's album shelves, and who an album is credited to so
 * its hero's artist line opens their page.
 */
import { sql } from "drizzle-orm";
import type { LibraryDatabase } from "@wave/client/db/database";
import { selectArtistAlbums } from "@wave/client/db/artists";
import type { BrowseRow } from "../../shared/browse.ts";
import type { ArtistAlbums, CreditedArtist } from "../../shared/artistPage.ts";
import { browseRows } from "./browse.ts";

/** The artist [artistId]'s Albums and Appears on, each newest first, as album rows. */
export const artistAlbums = (db: LibraryDatabase, artistId: number): ArtistAlbums => {
  const split = selectArtistAlbums(db, artistId);
  const rows = (albums: readonly { readonly id: number }[]): BrowseRow[] =>
    browseRows(
      db,
      "albums",
      albums.map((album) => album.id),
    );
  return { albums: rows(split.albums), appearsOn: rows(split.appearsOn) };
};

/** The artists the album [albumId]'s album artist credit names, in credit order. */
export const albumArtists = (db: LibraryDatabase, albumId: number): CreditedArtist[] =>
  db.all<CreditedArtist>(
    sql`SELECT a.id, a.name FROM album_artists aa JOIN artists a ON a.id=aa.artist_id
      WHERE aa.album_id=${albumId} ORDER BY aa.position`,
  );
