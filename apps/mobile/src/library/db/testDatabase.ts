/**
 * The library database for store tests, run by plain Node (`pnpm test`): an
 * in-memory SQLite (sql.js) with every migration applied by Drizzle's Expo
 * migrator, exactly as the app applies them on the phone, and helpers that
 * seed fixture tracks.
 */
import { drizzle } from "drizzle-orm/sql-js";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import initSqlJs from "sql.js";

import migrations from "./migrations.ts";
import * as schema from "./schema.ts";

export type TestDatabase = Awaited<ReturnType<typeof openTestDatabase>>;

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
  // The Expo migrator is typed for Expo's database but only uses the dialect
  // and session every synchronous SQLite driver shares.
  await migrate(
    db as unknown as Migrator,
    options.through === undefined ? migrations : migrationsThrough(options.through),
  );
  return db;
};

/** Applies the migrations a database opened `through` an older one is missing. */
export const migrateTestDatabase = async (db: TestDatabase): Promise<void> => {
  await migrate(db as unknown as Migrator, migrations);
};

export interface FixtureTrack {
  readonly title: string;
  readonly artist?: string;
  readonly album?: string;
  readonly albumArtist?: string;
  readonly year?: number;
  readonly durationMs?: number;
  /** When the file entered the library. */
  readonly addedAt?: number;
  readonly artworkHash?: string;
  /** Files the track under this genre (made on first use). */
  readonly genre?: string;
}

/** Stars a track at `addedAt`. */
export const star = (db: TestDatabase, trackId: number, addedAt: number): void => {
  db.insert(schema.favorites).values({ trackId, addedAt }).run();
};

const upsertId = <T extends { id: number }>(existing: T | undefined, insert: () => T): number =>
  (existing ?? insert()).id;

/** Adds a track (with its artist, album and folder, made on first use); returns its id. */
export const addTrack = (db: TestDatabase, track: FixtureTrack): number => {
  const { artists, albums, folders, genres, tracks, artwork } = schema;
  const artistName = track.artist ?? "Artist";
  const albumTitle = track.album ?? `${track.title} (single)`;
  const albumArtistName = track.albumArtist ?? artistName;

  const artistId = (name: string): number =>
    upsertId(
      db
        .select()
        .from(artists)
        .all()
        .find((row) => row.name === name),
      () =>
        db.insert(artists).values({ key: name, name, sort: name.toLowerCase() }).returning().get(),
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
  const albumKey = `${albumTitle}|${albumArtistName}`;
  const albumId = upsertId(
    db
      .select()
      .from(albums)
      .all()
      .find((row) => row.key === albumKey),
    () =>
      db
        .insert(albums)
        .values({
          key: albumKey,
          title: albumTitle,
          titleSort: albumTitle.toLowerCase(),
          albumArtistId: artistId(albumArtistName),
          year: track.year ?? null,
          artworkHash: track.artworkHash ?? null,
        })
        .returning()
        .get(),
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
  return db
    .insert(tracks)
    .values({
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
    })
    .returning()
    .get().id;
};
