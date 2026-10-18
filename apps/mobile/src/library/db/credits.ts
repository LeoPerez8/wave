/**
 * Artist credits (docs/spec.md, glossary: Artist): a track or album belongs to
 * every artist its credit names, as Core's `creditSplitter` splits it with the
 * Library's whole credits in mind. Tracks and albums keep their credit as
 * written, and the separate credits a multi-value tag gave (`artist_credits` /
 * `album_artist_credits`, null for a single one); `track_artists` /
 * `album_artists` link each credited artist in credit order, and `artist_id` /
 * `album_artist_id` hold the primary (first) one. Kept free of Expo so the
 * store tests run it against a real SQLite.
 */
import { creditSplitter, identityKey, respreadDeletedSongs, sortKey } from "@wave/core";
import { sql } from "drizzle-orm";

import { refreshArtistImages } from "./artists.ts";
import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";

/** Rows per statement (several values each), well under SQLite's limit on bound values. */
const ROWS_PER_STATEMENT = 200;

/** A track's or album's credits: one per value of its tag, usually one. */
export type Credits = readonly string[];

/** How a row's credits are stored: null for the single one it shows, else each of them. */
export const storedCredits = (credits: Credits): string | null =>
  credits.length === 1 ? null : JSON.stringify(credits);

/** A row's credits from the credit it shows and the stored ones (`storedCredits`). */
export const readCredits = (credit: string, stored: string | null): Credits =>
  stored === null ? [credit] : (JSON.parse(stored) as string[]);

/** The credits of every track (artist) and album (album artist) in the Library. */
const SELECT_CREDITS = sql`SELECT 'track' AS "kind", id AS "id", artist_credit AS "credit",
    artist_credits AS "stored" FROM tracks
  UNION ALL SELECT 'album', id, album_artist_credit, album_artist_credits FROM albums`;

interface CreditRow {
  readonly kind: "track" | "album";
  readonly id: number;
  readonly credits: Credits;
}

const creditRows = (db: LibraryDatabase): CreditRow[] =>
  db
    .all<{ kind: "track" | "album"; id: number; credit: string; stored: string | null }>(
      SELECT_CREDITS,
    )
    .map((row) => ({ kind: row.kind, id: row.id, credits: readCredits(row.credit, row.stored) }));

/** Every whole credit in the Library: the tracks' artist credits and the albums' album artist ones. */
const libraryCredits = (db: LibraryDatabase): Set<string> =>
  new Set(
    db
      .all<{ credit: string; stored: string | null }>(
        sql`SELECT DISTINCT artist_credit AS "credit", artist_credits AS "stored" FROM tracks
          UNION SELECT album_artist_credit, album_artist_credits FROM albums`,
      )
      .flatMap((row) => readCredits(row.credit, row.stored)),
  );

type Splitter = (credits: string | Credits) => readonly string[];

/**
 * The Library's whole credits and the splitter built from them (Core's
 * `creditSplitter`), kept by the store between saves: a scan reads the
 * Library's credits once, builds again only when a batch brings a credit the
 * Library didn't have, and re-files the Library at its end only when its
 * credits changed. Make one per database with `creditSplits`.
 */
export interface CreditSplits {
  /** The whole credits [split] was built from; null until the Library is first read. */
  known: Set<string> | null;
  split: Splitter;
  /**
   * Whether some links may not follow [split]: a save brought a credit others
   * split by, or this session hasn't re-filed the Library yet (a scan cut short
   * may have left it so).
   */
  stale: boolean;
  readonly build: (knownCredits: Iterable<string>) => Splitter;
}

const unread: Splitter = () => {
  throw new Error("The Library's credits weren't read");
};

/** Credit splits for one database; [build] makes a splitter (Core's `creditSplitter`). */
export const creditSplits = (
  build: (knownCredits: Iterable<string>) => Splitter = creditSplitter,
): CreditSplits => ({ known: null, split: unread, stale: true, build });

/** The splitter for [credits]: the Library's whole credits and theirs. */
const splitterFor = (db: LibraryDatabase, splits: CreditSplits, credits: Credits): Splitter => {
  const known = splits.known ?? libraryCredits(db);
  const fresh = credits.filter((credit) => !known.has(credit));
  if (splits.known !== null && fresh.length === 0) return splits.split;
  for (const credit of fresh) known.add(credit);
  splits.known = known;
  splits.split = splits.build(known);
  if (fresh.length > 0) splits.stale = true;
  return splits.split;
};

const sameCredits = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((credit) => b.has(credit));

/** The ids of the artists [names] (by identity key) holds, making the missing ones. */
const artistIds = (
  db: LibraryDatabase,
  names: ReadonlyMap<string, string>,
): Map<string, number> => {
  const rows = [...names].map(([key, name]) => ({ key, name, sort: sortKey(name) }));
  for (const chunk of chunks(rows, ROWS_PER_STATEMENT)) {
    db.run(sql`INSERT INTO artists (key, name, sort) VALUES ${sql.join(
      chunk.map((row) => sql`(${row.key}, ${row.name}, ${row.sort})`),
      sql`, `,
    )} ON CONFLICT (key) DO UPDATE SET name = excluded.name, sort = excluded.sort
      WHERE artists.name <> excluded.name`);
  }
  const ids = new Map<string, number>();
  for (const chunk of chunks(rows)) {
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
  splits: CreditSplits,
  credits: readonly Credits[],
): ((credits: Credits) => number[]) => {
  const split = splitterFor(db, splits, credits.flat());
  const names = new Map<string, string>();
  const keysByCredits = new Map<string, string[]>();
  for (const each of credits) {
    const id = JSON.stringify(each);
    if (keysByCredits.has(id)) continue;
    const keys = split(each).map((name) => {
      const key = identityKey(name);
      if (!names.has(key)) names.set(key, name);
      return key;
    });
    keysByCredits.set(id, keys);
  }
  const ids = artistIds(db, names);
  return (row) => {
    const keys = keysByCredits.get(JSON.stringify(row));
    if (keys === undefined) throw new Error(`Credit not split: ${row.join(", ")}`);
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
      : chunks(ids).flatMap((chunk) =>
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
 * Deletes the artists nothing is credited to any more. Plays of deleted songs
 * that counted for such an artist count for the artists Core's
 * `respreadDeletedSongs` hands them to instead.
 */
const pruneArtists = (db: LibraryDatabase, split: Splitter): void => {
  const pruned = db.all<{ id: number; name: string }>(
    sql`SELECT id AS "id", name AS "name" FROM artists WHERE NOT ${LINKED}`,
  );
  if (pruned.length === 0) return;
  const staying = new Map(
    db
      .all<{ id: number; key: string }>(
        sql`SELECT id AS "id", key AS "key" FROM artists WHERE ${LINKED}`,
      )
      .map((row) => [row.key, row.id] as const),
  );
  // The deleted songs crediting a pruned artist, with every artist each credits.
  const deletedSongs = new Map<number, number[]>();
  const rows = db.all<{ track: number; artist: number }>(
    sql`SELECT track_id AS "track", artist_id AS "artist" FROM deleted_track_artists
      WHERE track_id IN (SELECT track_id FROM deleted_track_artists
        WHERE artist_id IN (SELECT id FROM artists WHERE NOT ${LINKED}))
      ORDER BY track_id, position`,
  );
  for (const row of rows) {
    const artists = deletedSongs.get(row.track) ?? [];
    artists.push(row.artist);
    deletedSongs.set(row.track, artists);
  }
  const changed = respreadDeletedSongs({
    pruned,
    staying,
    deletedSongs,
    split,
  });
  for (const [track, artists] of changed) {
    db.run(sql`DELETE FROM deleted_track_artists WHERE track_id = ${track}`);
    db.run(
      sql`INSERT INTO deleted_track_artists (track_id, artist_id, position) VALUES ${sql.join(
        artists.map((artist, position) => sql`(${track}, ${artist}, ${position})`),
        sql`, `,
      )}`,
    );
  }
  // Their deleted songs' links go with them.
  db.run(sql`DELETE FROM artists WHERE NOT ${LINKED}`);
};

/**
 * Splits every credit in the Library again and re-files what changed, when
 * the Library's whole credits changed since it last did (a new or gone whole
 * credit can change how others split) or a save left links behind; then
 * deletes the artists left with no songs. Run it in the transaction that
 * changed the Library's credits (a scan's end, deleting songs).
 */
export const relinkCredits = (db: LibraryDatabase, splits: CreditSplits): void => {
  const current = libraryCredits(db);
  if (splits.known === null || !sameCredits(splits.known, current)) {
    splits.known = current;
    splits.split = splits.build(current);
    splits.stale = true;
  }
  if (splits.stale) relinkAll(db, splits);
  pruneArtists(db, splits.split);
};

/** Splits every credit in the Library and re-files what changed. */
const relinkAll = (db: LibraryDatabase, splits: CreditSplits): void => {
  const rows = creditRows(db);
  const credited = creditArtists(
    db,
    splits,
    rows.map((row) => row.credits),
  );
  const links = (kind: CreditRow["kind"]): CreditLink[] =>
    rows
      .filter((row) => row.kind === kind)
      .map((row) => ({ id: row.id, artistIds: credited(row.credits) }));
  writeLinks(db, TRACKS, links("track"), currentLinks(db, TRACKS, undefined));
  writeLinks(db, ALBUMS, links("album"), currentLinks(db, ALBUMS, undefined));
  splits.stale = false;
};

/**
 * Splits the Library's credits when some track or album isn't linked to its
 * artists yet: once, after the upgrade that brought credits in (migration
 * 0012), so the Library is re-filed without a rescan. The artists it brings
 * in get their image at once.
 */
export const relinkCreditsIfUnlinked = (db: LibraryDatabase, splits: CreditSplits): void => {
  const unlinked = db.get<{ unlinked: number }>(sql`SELECT
    EXISTS (SELECT 1 FROM tracks WHERE id NOT IN (SELECT track_id FROM track_artists))
    OR EXISTS (SELECT 1 FROM albums WHERE id NOT IN (SELECT album_id FROM album_artists))
    AS "unlinked"`);
  if (!unlinked.unlinked) return;
  db.transaction((tx) => {
    splits.stale = true;
    relinkCredits(tx, splits);
    refreshArtistImages(tx);
  });
};
