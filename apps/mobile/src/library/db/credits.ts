/**
 * Artist credits (docs/spec.md, glossary: Artist): a track or album belongs to
 * every artist its credit names, as Core's `creditSplitter` splits it with the
 * Library's whole credits in mind. Tracks and albums keep their credit as
 * written; `track_artists` / `album_artists` link each credited artist in
 * credit order, and `artist_id` / `album_artist_id` hold the primary (first)
 * one. Kept free of Expo so the store tests run it against a real SQLite.
 */
import { creditSplitter, identityKey, sortKey } from "@wave/core";
import { sql } from "drizzle-orm";

import { refreshArtistImages } from "./artists.ts";
import type { LibraryDatabase } from "./database.ts";

/** Rows per statement, well under SQLite's limit on bound values. */
const CHUNK = 200;

const chunked = <A>(items: readonly A[]): A[][] => {
  const result: A[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) result.push(items.slice(i, i + CHUNK));
  return result;
};

/** Every whole credit in the Library: the tracks' artist credits and the albums' album artist ones. */
const libraryCredits = (db: LibraryDatabase): string[] =>
  db
    .all<{ credit: string }>(
      sql`SELECT artist_credit AS "credit" FROM tracks
        UNION SELECT album_artist_credit FROM albums`,
    )
    .map((row) => row.credit);

/** The ids of the artists [names] (by identity key) holds, making the missing ones. */
const artistIds = (
  db: LibraryDatabase,
  names: ReadonlyMap<string, string>,
): Map<string, number> => {
  const rows = [...names].map(([key, name]) => ({ key, name, sort: sortKey(name) }));
  for (const chunk of chunked(rows)) {
    db.run(sql`INSERT INTO artists (key, name, sort) VALUES ${sql.join(
      chunk.map((row) => sql`(${row.key}, ${row.name}, ${row.sort})`),
      sql`, `,
    )} ON CONFLICT (key) DO UPDATE SET name = excluded.name, sort = excluded.sort
      WHERE artists.name <> excluded.name`);
  }
  const ids = new Map<string, number>();
  for (const chunk of chunked(rows)) {
    const found = db.all<{ id: number; key: string }>(
      sql`SELECT id AS "id", key AS "key" FROM artists WHERE key IN (${sql.join(
        chunk.map((row) => sql`${row.key}`),
        sql`, `,
      )})`,
    );
    for (const row of found) ids.set(row.key, row.id);
  }
  return ids;
};

/**
 * The artists each of [credits] names, as ids in credit order (the primary
 * first), split with the Library's whole credits and [credits] in mind; the
 * artists missing from the Library are made. Run it in the transaction that
 * saves what the credits belong to.
 */
export const creditArtists = (
  db: LibraryDatabase,
  credits: readonly string[],
): ((credit: string) => number[]) => {
  const split = creditSplitter([...libraryCredits(db), ...credits]);
  const names = new Map<string, string>();
  const keysByCredit = new Map<string, string[]>();
  for (const credit of new Set(credits)) {
    const keys = split(credit).map((name) => {
      const key = identityKey(name);
      if (!names.has(key)) names.set(key, name);
      return key;
    });
    keysByCredit.set(credit, keys);
  }
  const ids = artistIds(db, names);
  return (credit) => {
    const keys = keysByCredit.get(credit);
    if (keys === undefined) throw new Error(`Credit not split: ${credit}`);
    return keys.map((key) => {
      const id = ids.get(key);
      if (id === undefined) throw new Error(`Missing artist id for ${key}`);
      return id;
    });
  };
};

/** A track's or album's credited artists, in credit order. */
export interface CreditLink {
  readonly id: number;
  readonly artistIds: readonly number[];
}

interface LinkTable {
  /** The link table, the column naming what it links, and that thing's table and primary artist. */
  readonly links: string;
  readonly owner: string;
  readonly table: string;
  readonly primary: string;
}

const TRACKS: LinkTable = {
  links: "track_artists",
  owner: "track_id",
  table: "tracks",
  primary: "artist_id",
};
const ALBUMS: LinkTable = {
  links: "album_artists",
  owner: "album_id",
  table: "albums",
  primary: "album_artist_id",
};

/** The current links of [ids] (every one when undefined), in credit order. */
const currentLinks = (
  db: LibraryDatabase,
  table: LinkTable,
  ids: readonly number[] | undefined,
): Map<number, number[]> => {
  const links = sql.raw(table.links);
  const owner = sql.raw(table.owner);
  const read = (where: ReturnType<typeof sql>) =>
    db.all<{ owner: number; artist: number }>(
      sql`SELECT ${owner} AS "owner", artist_id AS "artist" FROM ${links} ${where}
        ORDER BY ${owner}, position`,
    );
  const rows =
    ids === undefined
      ? read(sql``)
      : chunked(ids).flatMap((chunk) =>
          read(
            sql`WHERE ${owner} IN (${sql.join(
              chunk.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          ),
        );
  const current = new Map<number, number[]>();
  for (const row of rows) {
    const artists = current.get(row.owner) ?? [];
    artists.push(row.artist);
    current.set(row.owner, artists);
  }
  return current;
};

const sameArtists = (a: readonly number[] | undefined, b: readonly number[]): boolean =>
  a !== undefined && a.length === b.length && a.every((id, i) => id === b[i]);

/** Rewrites the links (and primary artist) of each of [links] that changed. */
const writeLinks = (
  db: LibraryDatabase,
  table: LinkTable,
  links: readonly CreditLink[],
  current: ReadonlyMap<number, readonly number[]>,
): void => {
  const linkTable = sql.raw(table.links);
  const owner = sql.raw(table.owner);
  for (const link of links) {
    const [primary] = link.artistIds;
    if (primary === undefined || sameArtists(current.get(link.id), link.artistIds)) continue;
    db.run(sql`DELETE FROM ${linkTable} WHERE ${owner} = ${link.id}`);
    db.run(
      sql`INSERT INTO ${linkTable} (${owner}, artist_id, position) VALUES ${sql.join(
        link.artistIds.map((artist, position) => sql`(${link.id}, ${artist}, ${position})`),
        sql`, `,
      )}`,
    );
    db.run(
      sql`UPDATE ${sql.raw(table.table)} SET ${sql.raw(table.primary)} = ${primary}
        WHERE id = ${link.id}`,
    );
  }
};

/** Files tracks under their credited artists ([links]); the first is the primary artist. */
export const linkTracks = (db: LibraryDatabase, links: readonly CreditLink[]): void =>
  writeLinks(
    db,
    TRACKS,
    links,
    currentLinks(
      db,
      TRACKS,
      links.map((link) => link.id),
    ),
  );

/** Files albums under their credited album artists ([links]); the first is the one it's filed under. */
export const linkAlbums = (db: LibraryDatabase, links: readonly CreditLink[]): void =>
  writeLinks(
    db,
    ALBUMS,
    links,
    currentLinks(
      db,
      ALBUMS,
      links.map((link) => link.id),
    ),
  );

/** Whether an artist is credited anywhere (or still primary somewhere). */
const LINKED = sql`(id IN (SELECT artist_id FROM track_artists)
  OR id IN (SELECT artist_id FROM album_artists)
  OR id IN (SELECT artist_id FROM tracks)
  OR id IN (SELECT album_artist_id FROM albums))`;

/**
 * Gives the deleted songs credited to [whole] (`deleted_track_artists`) the
 * artists [split] in its place, in credit order, a name credited twice once.
 */
const respreadDeletedSongs = (db: LibraryDatabase, whole: number, split: readonly number[]) => {
  const rows = db.all<{ track: number; artist: number }>(
    sql`SELECT track_id AS "track", artist_id AS "artist" FROM deleted_track_artists
      WHERE track_id IN (SELECT track_id FROM deleted_track_artists WHERE artist_id = ${whole})
      ORDER BY track_id, position`,
  );
  const byTrack = new Map<number, number[]>();
  for (const row of rows) {
    const artists = byTrack.get(row.track) ?? [];
    artists.push(...(row.artist === whole ? split : [row.artist]));
    byTrack.set(row.track, artists);
  }
  for (const [track, artists] of byTrack) {
    db.run(sql`DELETE FROM deleted_track_artists WHERE track_id = ${track}`);
    db.run(
      sql`INSERT INTO deleted_track_artists (track_id, artist_id, position) VALUES ${sql.join(
        [...new Set(artists)].map((artist, position) => sql`(${track}, ${artist}, ${position})`),
        sql`, `,
      )}`,
    );
  }
};

/**
 * Deletes the artists nothing is credited to any more. Plays of deleted songs
 * that counted for such an artist (a whole credit from before credits were
 * split, "Ariana Grande, Doja Cat") count for each artist it names that is in
 * the Library instead.
 */
const pruneArtists = (db: LibraryDatabase): void => {
  const orphans = db.all<{ id: number; name: string }>(
    sql`SELECT id AS "id", name AS "name" FROM artists WHERE NOT ${LINKED}`,
  );
  if (orphans.length === 0) return;
  const split = creditSplitter(libraryCredits(db));
  for (const orphan of orphans) {
    const keys = split(orphan.name).map(identityKey);
    if (keys.length === 0 || (keys.length === 1 && keys[0] === identityKey(orphan.name))) continue;
    const linked = new Map(
      db
        .all<{ id: number; key: string }>(
          sql`SELECT id AS "id", key AS "key" FROM artists WHERE ${LINKED} AND key IN (${sql.join(
            keys.map((key) => sql`${key}`),
            sql`, `,
          )})`,
        )
        .map((row) => [row.key, row.id] as const),
    );
    const artists = keys.flatMap((key) => linked.get(key) ?? []);
    if (artists.length > 0) respreadDeletedSongs(db, orphan.id, artists);
  }
  // Their deleted songs' links go with them.
  db.run(sql`DELETE FROM artists WHERE NOT ${LINKED}`);
};

/**
 * Splits every credit in the Library again and re-files what changed, then
 * deletes the artists left with no songs. Run it in the transaction that
 * changed the Library's credits (a scan's end, deleting songs), since a new
 * or gone whole credit can change how others split.
 */
export const relinkCredits = (db: LibraryDatabase): void => {
  const tracks = db.all<{ id: number; credit: string }>(
    sql`SELECT id AS "id", artist_credit AS "credit" FROM tracks`,
  );
  const albums = db.all<{ id: number; credit: string }>(
    sql`SELECT id AS "id", album_artist_credit AS "credit" FROM albums`,
  );
  const credit = creditArtists(
    db,
    [...tracks, ...albums].map((row) => row.credit),
  );
  const links = (rows: readonly { id: number; credit: string }[]): CreditLink[] =>
    rows.map((row) => ({ id: row.id, artistIds: credit(row.credit) }));
  writeLinks(db, TRACKS, links(tracks), currentLinks(db, TRACKS, undefined));
  writeLinks(db, ALBUMS, links(albums), currentLinks(db, ALBUMS, undefined));
  pruneArtists(db);
};

/**
 * Splits the Library's credits when some track or album isn't linked to its
 * artists yet: once, after the upgrade that brought credits in (migration
 * 0012), so the Library is re-filed without a rescan. The artists it brings
 * in get their image at once.
 */
export const relinkCreditsIfUnlinked = (db: LibraryDatabase): void => {
  const unlinked = db.get<{ unlinked: number }>(sql`SELECT
    EXISTS (SELECT 1 FROM tracks WHERE id NOT IN (SELECT track_id FROM track_artists))
    OR EXISTS (SELECT 1 FROM albums WHERE id NOT IN (SELECT album_id FROM album_artists))
    AS "unlinked"`);
  if (!unlinked.unlinked) return;
  db.transaction((tx) => {
    relinkCredits(tx);
    refreshArtistImages(tx);
  });
};
