/**
 * The rows behind a link to an album or artist (Go to Album / Artist, Now
 * Playing, an album's artist), read ahead so the screen it opens draws its
 * header on the first frame. Kept free of Expo so the store tests run it
 * against a real SQLite (`testDatabase.ts`).
 */
import { eq } from "drizzle-orm";

import type { AlbumRow, ArtistRow } from "../LibraryStore.ts";
import { selectAlbums } from "./albums.ts";
import { selectArtists } from "./artists.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

export interface LinkIds {
  readonly albumId?: number | undefined;
  readonly artistId?: number | undefined;
}

export interface LinkRows {
  /** Null when not asked for or gone from the library. */
  readonly album: AlbumRow | null;
  readonly artist: ArtistRow | null;
}

/** The album and artist rows, as their lists show them, of the links asked for. */
export const selectLinkRows = (db: LibraryDatabase, { albumId, artistId }: LinkIds): LinkRows => ({
  album:
    albumId === undefined ? null : (selectAlbums(db, eq(schema.albums.id, albumId))[0] ?? null),
  artist: artistId === undefined ? null : (selectArtists(db, { ids: [artistId] })[0] ?? null),
});
