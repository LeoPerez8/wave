import { streamedCredits, type YtAlbumSong } from "@wave/core";
import { sql } from "drizzle-orm";

import { selectAlbums } from "./albums.ts";
import { selectArtists } from "./artists.ts";
import { readCredits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { albumArtistIds } from "./tracks.ts";

const libraryCredits = (db: LibraryDatabase): string[] =>
  db
    .all<{ credit: string; stored: string | null }>(
      sql`
    SELECT DISTINCT artist_credit AS credit, artist_credits AS stored FROM tracks
    UNION SELECT album_artist_credit, album_artist_credits FROM albums`,
    )
    .flatMap(({ credit, stored }) => readCredits(credit, stored));

/** What Core's credit resolver matches streamed songs against: the Library's artists, albums and credits. */
export const playedLibraryRows = (db: LibraryDatabase, withAlbums = true) => ({
  artists: selectArtists(db, {}),
  albums: withAlbums ? selectAlbums(db, undefined) : [],
  credits: libraryCredits(db),
});

export type PlayedLibraryRows = ReturnType<typeof playedLibraryRows>;

/** How many artists, albums or credit rows one step of `playedLibraryRowsSteps` reads. */
const ROWS_STEP = 500;

const pages = <A>(rows: readonly A[]): A[][] => {
  const all: A[][] = [];
  for (let from = 0; from < rows.length; from += ROWS_STEP)
    all.push(rows.slice(from, from + ROWS_STEP));
  return all;
};

const ids = (db: LibraryDatabase, query: ReturnType<typeof sql>): number[] =>
  db.all<{ id: number }>(query).map((row) => row.id);

const asJson = (values: readonly number[]) => JSON.stringify(values);

/** What the resolver reads of the Library: each artist's and album's id and name, and the credits. */
export interface ResolverLibraryRows {
  readonly artists: readonly { readonly id: number; readonly name: string }[];
  readonly albums: readonly {
    readonly id: number;
    readonly title: string;
    readonly albumArtistIds: readonly number[];
  }[];
  readonly credits: readonly string[];
}

/**
 * What Core's credit resolver matches against, as `playedLibraryRows` reads
 * it (the same artists, albums and credits, in its order), a page at a time
 * for work that runs in slices: the ids in the read's order first, then
 * [ROWS_STEP] rows per step, and only the columns the resolver uses.
 */
export function* playedLibraryRowsSteps(db: LibraryDatabase): Generator<void, ResolverLibraryRows> {
  const artists: { id: number; name: string }[] = [];
  const artistIds = ids(db, sql`SELECT id FROM artists ORDER BY sort, id`);
  yield;
  for (const page of pages(artistIds)) {
    // An artist with a song: credited on one, or the album artist of an album with one (`selectArtists`).
    artists.push(
      ...db.all<{ id: number; name: string }>(sql`SELECT id, name FROM artists
        WHERE id IN (SELECT value FROM json_each(${asJson(page)}))
          AND (EXISTS (SELECT 1 FROM track_artists WHERE track_artists.artist_id = artists.id)
            OR EXISTS (SELECT 1 FROM album_artists JOIN tracks ON tracks.album_id = album_artists.album_id
              WHERE album_artists.artist_id = artists.id))
        ORDER BY sort, id`),
    );
    yield;
  }
  const albums: { id: number; title: string; albumArtistIds: readonly number[] }[] = [];
  const albumIds = ids(
    db,
    sql`SELECT albums.id FROM albums JOIN artists ON artists.id = albums.album_artist_id
      ORDER BY albums.title_sort, artists.sort, albums.id`,
  );
  yield;
  const { albums: table, tracks } = schema;
  for (const page of pages(albumIds)) {
    // An album with a song (`selectAlbums`), in the order of [albumIds].
    const rows = new Map(
      db
        .select({ id: table.id, title: table.title, albumArtistIds })
        .from(table)
        .where(
          sql`${table.id} IN (SELECT value FROM json_each(${asJson(page)}))
            AND EXISTS (SELECT 1 FROM ${tracks} WHERE ${tracks.albumId} = ${table.id})`,
        )
        .all()
        .map((row) => [row.id, row]),
    );
    for (const id of page) {
      const row = rows.get(id);
      if (row !== undefined) albums.push(row);
    }
    yield;
  }
  // Each distinct credit once, as the whole read gives them, a page of tracks or albums a step.
  const seen = new Set<string>();
  const credits: string[] = [];
  const add = (rows: readonly { credit: string; stored: string | null }[]) => {
    for (const { credit, stored } of rows) {
      const key = `${credit}\u0000${stored ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      credits.push(...readCredits(credit, stored));
    }
  };
  for (const [table, credit, stored] of [
    ["tracks", "artist_credit", "artist_credits"],
    ["albums", "album_artist_credit", "album_artist_credits"],
  ] as const) {
    for (let after = 0; ; ) {
      const rows = db.all<{ id: number; credit: string; stored: string | null }>(
        sql`SELECT id, ${sql.raw(credit)} AS credit, ${sql.raw(stored)} AS stored
          FROM ${sql.raw(table)} WHERE id > ${after} ORDER BY id LIMIT ${ROWS_STEP}`,
      );
      add(rows);
      yield;
      if (rows.length < ROWS_STEP) break;
      after = rows.at(-1)!.id;
    }
  }
  return { artists, albums, credits };
}

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
