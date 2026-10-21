/**
 * The library database for store tests, run by plain Node (`pnpm test`): an
 * in-memory SQLite (sql.js) with every migration applied by Drizzle's Expo
 * migrator, exactly as the app applies them on the phone, and helpers that
 * seed fixture tracks.
 */
import { albumKey as coreAlbumKey, identityKey } from "@wave/core";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sql-js";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import initSqlJs from "sql.js";

import { creditSplits, relinkCreditsIfUnlinked } from "./credits.ts";
import migrations from "./migrations.ts";
import { setFavorites } from "./playHistory.ts";
import * as schema from "./schema.ts";
import { keyRecordings } from "./sync.ts";

export type TestDatabase = Awaited<ReturnType<typeof openTestDatabase>>;

type SqlJsClient = InstanceType<Awaited<ReturnType<typeof initSqlJs>>["Database"]>;

/** Each test database's sql.js client, for `traceQueries`. */
const clients = new WeakMap<object, SqlJsClient>();

type Migrator = Parameters<typeof migrate>[0];

/** The migrations up to and including the one tagged `through`. */
const migrationsThrough = (through: string): typeof migrations => {
  const last = migrations.journal.entries.findIndex((entry) => entry.tag === through);
  if (last < 0) throw new Error(`no migration tagged ${through}`);
  return { ...migrations, journal: { entries: migrations.journal.entries.slice(0, last + 1) } };
};

/**
 * Opens the database with every migration applied or, given a migration tag
 * (`through`), as the Wave that shipped it left it; `migrateTestDatabase`
 * then upgrades it as an app update does.
 */
export const openTestDatabase = async (options: { readonly through?: string } = {}) => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  // As on the phone: cascades only happen with foreign keys on.
  client.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(client, { schema });
  clients.set(db, client);
  // The Expo migrator is typed for Expo's database but only uses the dialect
  // and session every synchronous SQLite driver shares.
  await migrate(
    db as unknown as Migrator,
    options.through === undefined ? migrations : migrationsThrough(options.through),
  );
  return db;
};

/** Closes and reopens the persisted SQLite image, dropping all connection-local state. */
export const reopenTestDatabase = async (db: TestDatabase): Promise<TestDatabase> => {
  const client = clients.get(db);
  if (client === undefined) throw new Error("not a test database");
  const image = client.export();
  client.close();
  const SQL = await initSqlJs();
  const reopened = new SQL.Database(image);
  reopened.exec("PRAGMA foreign_keys = ON;");
  const next = drizzle(reopened, { schema });
  clients.set(next, reopened);
  await migrate(next as unknown as Migrator, migrations);
  return next;
};

/**
 * Applies the migrations a database opened `through` an older one is missing,
 * then what the store does after migrating (`relinkCreditsIfUnlinked`,
 * `keyRecordings`).
 */
export const migrateTestDatabase = async (db: TestDatabase): Promise<void> => {
  await migrate(db as unknown as Migrator, migrations);
  relinkCreditsIfUnlinked(db, creditSplits());
  keyRecordings(db);
};

/** A statement a read ran, with how SQLite planned it and the rows it returned. */
export interface TracedQuery {
  readonly sql: string;
  /** `EXPLAIN QUERY PLAN`'s steps, e.g. "SEARCH play_events USING INDEX play_events_track_idx (track_id=?)". */
  readonly plan: readonly string[];
  readonly rows: number;
}

/**
 * Runs [read] against [db] and records every statement it runs: its SQL,
 * SQLite's plan for it (with the values it was bound) and how many rows it
 * returned. Statements prepared but never run (Drizzle prepares some twice)
 * are left out.
 */
export const traceQueries = <A>(
  db: TestDatabase,
  read: () => A,
): { readonly result: A; readonly queries: readonly TracedQuery[] } => {
  const client = clients.get(db);
  if (client === undefined) throw new Error("not a test database");
  type Params = Parameters<SqlJsClient["exec"]>[1];
  const traced: { sql: string; params: Params; rows: number; ran: boolean }[] = [];
  const prepare = client.prepare;
  client.prepare = (text, params) => {
    const statement = prepare.call(client, text, params);
    const query = { sql: text, params, rows: 0, ran: false };
    traced.push(query);
    const bind = statement.bind;
    statement.bind = (values) => {
      if (values !== undefined) query.params = values;
      return bind.call(statement, values);
    };
    const step = statement.step;
    statement.step = () => {
      query.ran = true;
      const row = step.call(statement);
      if (row) query.rows += 1;
      return row;
    };
    return statement;
  };
  let result: A;
  try {
    result = read();
  } finally {
    client.prepare = prepare;
  }
  const queries = traced.flatMap(({ sql: text, params, rows, ran }) => {
    if (!ran) return [];
    return [
      {
        sql: text,
        rows,
        plan: client
          .exec(`EXPLAIN QUERY PLAN ${text}`, params)
          .flatMap((table) => table.values.map((step) => String(step[3]))),
      },
    ];
  });
  return { result, queries };
};

/**
 * Copies the track [seed] once per row `x` of [rows] (a `WITH RECURSIVE n(x)`
 * clause): each column is its SQL in [overrides] (over `x` and `seed`), or
 * the seed's own value.
 */
const copySeedTrack = (
  db: TestDatabase,
  seed: number,
  rows: string,
  overrides: Readonly<Record<string, string>>,
): void => {
  const columns = db
    .all<{ name: string }>(sql`PRAGMA table_info(tracks)`)
    .map((column) => column.name)
    .filter((name) => name !== "id");
  const quoted = columns.map((name) => `"${name}"`).join(", ");
  const values = columns.map((name) => overrides[name] ?? `seed."${name}"`).join(", ");
  db.run(
    sql.raw(`${rows} INSERT INTO tracks (${quoted})
      SELECT ${values} FROM n, tracks AS seed WHERE seed.id = ${seed}`),
  );
};

/**
 * Grows the library and its history fast, for benchmarks and scale tests:
 * [tracks] songs crediting a new artist [artist] (on one album, or spread
 * over [albums]), then [plays] counted plays spread over them, one in ten of a
 * song since deleted that still credits the artist (`deleted_track_artists`).
 * Written in bulk, so hundreds of thousands of plays take a second.
 */
export const addHistory = (
  db: TestDatabase,
  options: {
    readonly artist: string;
    readonly tracks: number;
    readonly plays: number;
    readonly albums?: number;
  },
): void => {
  const seed = addTrack(db, { title: `${options.artist} 1`, artist: options.artist });
  const { artistId } = db
    .select({ artistId: schema.tracks.artistId })
    .from(schema.tracks)
    .where(eq(schema.tracks.id, seed))
    .get()!;
  copySeedTrack(
    db,
    seed,
    `WITH RECURSIVE n(x) AS (VALUES(2) UNION ALL SELECT x + 1 FROM n WHERE x < ${options.tracks})`,
    {
      path: `'/Music/' || ${seed} || '-' || x || '.mp3'`,
      file_name: `${seed} || '-' || x || '.mp3'`,
      title: `'${options.artist.replaceAll("'", "''")} ' || x`,
      title_sort: `printf('%08d', x)`,
      recording_key: `'recording-' || ${seed} || '-' || x`,
    },
  );
  db.run(
    sql`INSERT INTO track_artists (track_id, artist_id, position)
      SELECT id, ${artistId}, 0 FROM tracks WHERE id > ${seed} AND artist_id = ${artistId}`,
  );
  const albums = options.albums ?? 1;
  if (albums > 1) {
    // Copies of the seed's album, keyed `<its key>-2` and up; the songs go round them.
    const album = sql`(SELECT album_id FROM tracks WHERE id = ${seed})`;
    db.run(
      sql`WITH RECURSIVE n(x) AS (VALUES(2) UNION ALL SELECT x + 1 FROM n WHERE x < ${albums})
        INSERT INTO albums (key, title, title_sort, album_artist_id, album_artist_credit)
        SELECT seed.key || '-' || x, seed.title || ' ' || x, seed.title_sort || printf('%08d', x),
          seed.album_artist_id, seed.album_artist_credit
        FROM n, albums AS seed WHERE seed.id = ${album}`,
    );
    db.run(
      sql`UPDATE tracks SET album_id = coalesce((SELECT albums.id FROM albums
          WHERE albums.key = (SELECT key FROM albums WHERE id = ${album})
            || '-' || ((tracks.id - ${seed}) % ${albums} + 1)), album_id)
        WHERE id > ${seed} AND artist_id = ${artistId}`,
    );
  }
  // Deleted songs' ids: past every track id, as AUTOINCREMENT never reuses them.
  const deleted = 1_000_000_000 + seed * 1_000;
  db.run(
    sql`INSERT INTO deleted_track_artists (track_id, artist_id, position)
      SELECT ${deleted} + value, ${artistId}, 0 FROM json_each('[0,1,2,3,4,5,6,7,8,9]')`,
  );
  db.run(
    sql.raw(`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < ${options.plays - 1})
      INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms, end_reason, counted, source)
      SELECT CASE WHEN x % 10 = 9 THEN ${deleted} + (x / 10) % 10 ELSE ${seed} + x % ${options.tracks} END,
        1000 + x, 180000, 180000, 'completed', 1, 'phone' FROM n`),
  );
};

export interface FixtureTrack {
  readonly title: string;
  readonly artist?: string;
  readonly album?: string;
  readonly albumArtist?: string;
  /** The track's year, which its album takes too. */
  readonly year?: number;
  readonly trackNumber?: number;
  readonly durationMs?: number;
  /** When the file entered the library. */
  readonly addedAt?: number;
  readonly artworkHash?: string;
  /** Files the track under this genre (made on first use). */
  readonly genre?: string;
  /** Lyrics in its tags or a sidecar (not recorded by databases from before 0011). */
  readonly hasLyrics?: boolean;
  /** What its advisory tag says (not recorded by databases from before 0026). */
  readonly explicit?: "explicit" | "clean" | "unknown";
}

/** Stars a track at `addedAt` (as the Wave of the database's schema did). */
export const star = (db: TestDatabase, trackId: number, addedAt: number): void => {
  if (hasColumn(db, "favorites", "changed_at")) setFavorites(db, [trackId], true, addedAt);
  else db.run(sql`INSERT INTO favorites (track_id, added_at) VALUES (${trackId}, ${addedAt})`);
};

const upsertId = <T extends { id: number }>(existing: T | undefined, insert: () => T): number =>
  (existing ?? insert()).id;

/** Adds a track (with its artist, album and folder, made on first use); returns its id. */
export const addTrack = (db: TestDatabase, track: FixtureTrack): number => {
  const { artists, albums, folders, genres, tracks, artwork } = schema;
  const artistName = track.artist ?? "Artist";
  const albumTitle = track.album ?? `${track.title} (single)`;
  const albumArtistName = track.albumArtist ?? artistName;

  // Only the columns every schema version has, so databases opened `through`
  // an older migration can be seeded too.
  const artistId = (name: string): number =>
    upsertId(
      db
        .select({ id: artists.id, name: artists.name })
        .from(artists)
        .all()
        .find((row) => row.name === name),
      () =>
        // Drizzle's insert names every column of today's schema.
        db.get<{ id: number }>(
          sql`INSERT INTO artists (key, name, sort) VALUES (${identityKey(name)}, ${name}, ${name.toLowerCase()}) RETURNING id`,
        ),
    );
  if (track.artworkHash !== undefined) {
    db.insert(artwork)
      .values({
        hash: track.artworkHash,
        path: `/covers/${track.artworkHash}.jpg`,
        thumbPath: `/covers/${track.artworkHash}.thumb.jpg`,
        palette: {},
      })
      .onConflictDoNothing()
      .run();
  }
  // As a scan files it, so missing songs and scanned files share their album.
  const albumKey = coreAlbumKey(albumTitle, albumArtistName);
  const albumId = upsertId(
    db
      .select({ id: albums.id, key: albums.key })
      .from(albums)
      .all()
      .find((row) => row.key === albumKey),
    () =>
      // Only the columns albums had from the start, as for tracks below.
      db.get<{ id: number }>(
        sql`INSERT INTO albums (key, title, title_sort, album_artist_id, year, artwork_hash)
          VALUES (${albumKey}, ${albumTitle}, ${albumTitle.toLowerCase()},
            ${artistId(albumArtistName)}, ${track.year ?? null}, ${track.artworkHash ?? null})
          RETURNING id`,
      ),
  );
  const folderId = upsertId(db.select().from(folders).all()[0], () =>
    db.insert(folders).values({ path: "/Music", name: "Music" }).returning().get(),
  );
  const genre = track.genre;
  const genreId =
    genre === undefined
      ? null
      : upsertId(
          db
            .select()
            .from(genres)
            .all()
            .find((row) => row.name === genre),
          () =>
            db
              .insert(genres)
              .values({ key: genre, name: genre, sort: genre.toLowerCase() })
              .returning()
              .get(),
        );
  const addedAt = track.addedAt ?? 0;
  const values = {
    path: `/Music/${albumTitle}/${track.title}.mp3`,
    folderId,
    fileName: `${track.title}.mp3`,
    sizeBytes: 1_000,
    modifiedAt: addedAt,
    title: track.title,
    titleSort: track.title.toLowerCase(),
    artistId: artistId(artistName),
    albumId,
    genreId,
    durationMs: track.durationMs ?? 180_000,
    artworkHash: track.artworkHash ?? null,
    addedAt,
    scannedAt: addedAt,
  };
  // Drizzle's insert names every column of today's schema; this names only the columns
  // tracks had from the start.
  const columns = Object.keys(values) as (keyof typeof values)[];
  const id = db.get<{ id: number }>(
    sql`INSERT INTO ${tracks} (${sql.join(
      columns.map((column) => sql.identifier(tracks[column].name)),
      sql`, `,
    )}) VALUES (${sql.join(
      columns.map((column) => sql`${values[column]}`),
      sql`, `,
    )}) RETURNING id`,
  ).id;
  if (track.hasLyrics !== undefined)
    db.update(tracks).set({ hasLyrics: track.hasLyrics }).where(eq(tracks.id, id)).run();
  if (track.explicit !== undefined)
    db.update(tracks).set({ explicit: track.explicit }).where(eq(tracks.id, id)).run();
  if (track.year !== undefined || track.trackNumber !== undefined)
    db.update(tracks)
      .set({ year: track.year ?? null, trackNumber: track.trackNumber ?? null })
      .where(eq(tracks.id, id))
      .run();
  if (hasCredits(db)) {
    // As an upgrade leaves the track before its credit is split: one artist, the whole credit.
    db.update(tracks).set({ artistCredit: artistName }).where(eq(tracks.id, id)).run();
    db.update(albums)
      .set({ albumArtistCredit: albumArtistName })
      .where(eq(albums.id, albumId))
      .run();
    db.insert(schema.trackArtists)
      .values({ trackId: id, artistId: artistId(artistName), position: 0 })
      .onConflictDoNothing()
      .run();
    db.insert(schema.albumArtists)
      .values({ albumId, artistId: artistId(albumArtistName), position: 0 })
      .onConflictDoNothing()
      .run();
  }
  // As saving a scanned file keys it.
  if (hasColumn(db, "tracks", "recording_key")) keyRecordings(db);
  return id;
};

/** Rows numbered 0 to [n] - 1 (`x` of table `n`), for bulk inserts. */
const count = (n: number): string =>
  `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < ${n - 1})`;

/** A name's first letter for row [x], spread over the alphabet. */
const letter = (x: string): string => `char(97 + (${x}) % 26)`;

/**
 * Grows the Library fast, for benchmarks and scale tests: [tracks] songs by
 * [artists] artists on [albums] albums (each with a cover), titles spread over
 * the alphabet, track numbers, a genre on every third song and one missing
 * song (no file) in fifty. Written in bulk: 10,000 songs take well under a second.
 */
export const addLibrary = (
  db: TestDatabase,
  options: { readonly tracks: number; readonly artists: number; readonly albums: number },
): void => {
  const seed = addTrack(db, {
    title: "Library seed",
    artist: "Library seed artist",
    artworkHash: "library-seed",
    genre: "Library genre",
  });
  const firstArtist = db.get<{ n: number }>(
    sql`SELECT coalesce(max(id), 0) + 1 AS n FROM artists`,
  ).n;
  const firstAlbum = db.get<{ n: number }>(sql`SELECT coalesce(max(id), 0) + 1 AS n FROM albums`).n;
  db.run(
    sql.raw(`${count(options.artists)} INSERT INTO artists (key, name, sort)
      SELECT 'library-artist-' || x, upper(${letter("x * 7")}) || 'rtist ' || x,
        ${letter("x * 7")} || 'rtist ' || printf('%05d', x) FROM n`),
  );
  db.run(
    sql.raw(`${count(options.albums)} INSERT INTO artwork (hash, path, thumb_path, palette)
      SELECT 'library-cover-' || x, '/covers/library-' || x || '.jpg',
        '/covers/library-' || x || '.thumb.jpg', '{}' FROM n`),
  );
  db.run(
    sql.raw(`${count(options.albums)} INSERT INTO albums (key, title, title_sort, album_artist_id,
        album_artist_credit, artwork_hash)
      SELECT 'library-album-' || x, upper(${letter("x * 11")}) || 'lbum ' || x,
        ${letter("x * 11")} || 'lbum ' || printf('%05d', x),
        ${firstArtist} + x % ${options.artists}, 'Artist ' || (x % ${options.artists}),
        'library-cover-' || x FROM n`),
  );
  const album = `(x % ${options.albums})`;
  copySeedTrack(db, seed, count(options.tracks), {
    path: `CASE WHEN x % 50 = 49 THEN NULL ELSE '/Music/Library/' || x || '.mp3' END`,
    file_name: `'library-' || x || '.mp3'`,
    title: `upper(${letter("x * 31")}) || 'ong ' || x`,
    title_sort: `${letter("x * 31")} || 'ong ' || printf('%06d', x)`,
    recording_key: `'library-recording-' || x`,
    artist_id: `${firstArtist} + ${album} % ${options.artists}`,
    artist_credit: `'Artist ' || (${album} % ${options.artists})`,
    album_id: `${firstAlbum} + ${album}`,
    artwork_hash: `'library-cover-' || ${album}`,
    genre_id: `CASE WHEN x % 3 = 0 THEN seed.genre_id ELSE NULL END`,
    track_number: `1 + (x / ${options.albums}) % 14`,
    added_at: `1000000 + x * 1000`,
  });
  db.run(sql`DELETE FROM tracks WHERE id = ${seed}`);
  db.run(sql`DELETE FROM track_artists WHERE track_id = ${seed}`);
  db.run(
    sql`INSERT OR IGNORE INTO track_artists (track_id, artist_id, position)
      SELECT id, artist_id, 0 FROM tracks WHERE id > ${seed}`,
  );
};

/**
 * Adds a missing song: a Track the Wave account has and this phone has no
 * file for (no path), filed as `addTrack` files a song; returns its id.
 */
export const addMissingSong = (db: TestDatabase, track: FixtureTrack): number => {
  const id = addTrack(db, track);
  db.update(schema.tracks).set({ path: null }).where(eq(schema.tracks.id, id)).run();
  return id;
};

/** Whether [table] has [column] in the database's schema. */
const hasColumn = (db: TestDatabase, table: string, column: string): boolean =>
  db.get<{ n: number }>(
    sql`SELECT count(*) AS n FROM pragma_table_info(${table}) WHERE name = ${column}`,
  ).n > 0;

/** Whether the database has credit links (migration 0012). */
const hasCredits = (db: TestDatabase): boolean =>
  db.get<{ n: number }>(
    sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'track_artists'`,
  ).n > 0;
