import { filesLeavingWithRoot, type LibraryTrack } from "@wave/core";
import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { drizzle, type ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { openDatabaseSync } from "expo-sqlite";

import migrations from "./db/migrations";
import * as schema from "./db/schema";

const DATABASE_NAME = "wave.db";

export class LibraryStoreError extends Data.TaggedError("LibraryStoreError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Library store failed to ${this.operation}: ${String(this.cause)}`;
  }
}

/** A track as the scanner reported it, after Core normalisation. */
export interface IndexedTrack extends LibraryTrack {
  readonly sizeBytes: number;
  readonly modifiedAt: number;
  readonly sampleRate: number | null;
  readonly bitrateKbps: number | null;
  readonly artworkHash: string | null;
}

export interface IndexedArtwork {
  readonly hash: string;
  readonly path: string;
  readonly thumbPath: string;
  readonly palette: schema.ArtworkPalette;
}

export interface ScanRoot {
  readonly path: string;
  readonly isDefault: boolean;
  readonly lastScannedAt: number | null;
}

/** A scan root with the number of indexed tracks under it, for Music folders. */
export interface ScanRootSummary extends ScanRoot {
  readonly trackCount: number;
}

/** One row of the Songs list. */
export interface SongRow {
  readonly id: number;
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly durationMs: number;
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
}

/** What Now Playing shows about a track beyond the player's item. */
export interface TrackDetails {
  readonly id: number;
  readonly artistId: number;
  readonly artist: string;
  readonly albumId: number;
  readonly album: string;
  readonly palette: schema.ArtworkPalette | null;
}

export class LibraryStore extends Context.Service<
  LibraryStore,
  {
    /** Adds [path] as a scan root when there are no roots yet; returns the roots. */
    readonly ensureDefaultRoot: (
      path: string,
    ) => Effect.Effect<readonly ScanRoot[], LibraryStoreError>;
    /** Every scan root in the order it was added, with its track count. */
    readonly listRoots: Effect.Effect<readonly ScanRootSummary[], LibraryStoreError>;
    /**
     * Adds [path] as a root the owner picked and removes the roots in [drop]
     * (see Core's `planAddRoot`). No root is a default one afterwards.
     */
    readonly addRoot: (
      path: string,
      drop: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Removes a root and the tracks no other root covers, then the albums,
     * artists, genres and folders left without tracks. The last root can't be removed.
     */
    readonly removeRoot: (path: string) => Effect.Effect<void, LibraryStoreError>;
    readonly excludedFolders: Effect.Effect<readonly string[], LibraryStoreError>;
    /** Upserts one scanner batch (and the artwork it references) in a single transaction. */
    readonly saveBatch: (
      tracks: readonly IndexedTrack[],
      artwork: readonly IndexedArtwork[],
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly markScanned: (
      roots: readonly string[],
      at: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly countTracks: Effect.Effect<number, LibraryStoreError>;
    /** Every track ordered by title, for Library › Songs. */
    readonly listSongs: Effect.Effect<readonly SongRow[], LibraryStoreError>;
    /** The playing track's links and artwork palette, for Now Playing; null once it's gone. */
    readonly trackDetails: (id: number) => Effect.Effect<TrackDetails | null, LibraryStoreError>;
    /** The tracks with these ids, in no particular order (missing ids are skipped). */
    readonly songsByIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly SongRow[], LibraryStoreError>;
  }
>()("@wave/mobile/library/LibraryStore") {}

type Database = ExpoSQLiteDatabase<typeof schema>;

/** `excluded.<column>` in an upsert's DO UPDATE clause. */
const excluded = (column: SQLiteColumn): SQL => sql.raw(`excluded."${column.name}"`);

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

const uniqueBy = <A>(items: Iterable<A>, key: (item: A) => string): A[] => {
  const seen = new Map<string, A>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
};

const idMap = (rows: readonly { id: number; key: string }[]): Map<string, number> =>
  new Map(rows.map((row) => [row.key, row.id]));

const requireId = (ids: Map<string, number>, key: string, kind: string): number => {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`Missing ${kind} id for ${key}`);
  return id;
};

const saveBatchSync = (
  db: Database,
  tracks: readonly IndexedTrack[],
  artworkRows: readonly IndexedArtwork[],
  now: number,
): void => {
  const { artists, genres, folders, albums, artwork } = schema;
  db.transaction((tx) => {
    if (artworkRows.length > 0) {
      tx.insert(artwork)
        .values(artworkRows.map((row) => ({ ...row })))
        .onConflictDoUpdate({
          target: artwork.hash,
          set: {
            path: excluded(artwork.path),
            thumbPath: excluded(artwork.thumbPath),
            palette: excluded(artwork.palette),
          },
        })
        .run();
    }
    if (tracks.length === 0) return;

    const artistRows = uniqueBy(
      tracks.flatMap((t) => [
        { key: t.artistKey, name: t.artist, sort: t.artistSort },
        { key: t.albumArtistKey, name: t.albumArtist, sort: t.albumArtistSort },
      ]),
      (row) => row.key,
    );
    const artistIds = idMap(
      tx
        .insert(artists)
        .values(artistRows)
        .onConflictDoUpdate({
          target: artists.key,
          set: { name: excluded(artists.name), sort: excluded(artists.sort) },
        })
        .returning({ id: artists.id, key: artists.key })
        .all(),
    );

    const genreRows = uniqueBy(
      tracks.flatMap((t) =>
        t.genre !== null && t.genreKey !== null && t.genreSort !== null
          ? [{ key: t.genreKey, name: t.genre, sort: t.genreSort }]
          : [],
      ),
      (row) => row.key,
    );
    const genreIds =
      genreRows.length === 0
        ? new Map<string, number>()
        : idMap(
            tx
              .insert(genres)
              .values(genreRows)
              .onConflictDoUpdate({
                target: genres.key,
                set: { name: excluded(genres.name), sort: excluded(genres.sort) },
              })
              .returning({ id: genres.id, key: genres.key })
              .all(),
          );

    const folderRows = uniqueBy(
      tracks.map((t) => ({ path: t.folder, name: basename(t.folder) })),
      (row) => row.path,
    );
    const folderIds = new Map(
      tx
        .insert(folders)
        .values(folderRows)
        .onConflictDoUpdate({ target: folders.path, set: { name: excluded(folders.name) } })
        .returning({ id: folders.id, path: folders.path })
        .all()
        .map((row) => [row.path, row.id] as const),
    );

    const albumRows = uniqueBy(
      tracks.map((t) => ({
        key: t.albumKey,
        title: t.album,
        titleSort: t.albumSort,
        albumArtistId: requireId(artistIds, t.albumArtistKey, "artist"),
        year: t.year,
        artworkHash: t.artworkHash,
        compilation: t.compilation,
      })),
      (row) => row.key,
    );
    const albumIds = idMap(
      tx
        .insert(albums)
        .values(albumRows)
        .onConflictDoUpdate({
          target: albums.key,
          set: {
            title: excluded(albums.title),
            titleSort: excluded(albums.titleSort),
            // The first track that has a year or a cover gives it to the album.
            year: sql`coalesce(${albums.year}, ${excluded(albums.year)})`,
            artworkHash: sql`coalesce(${albums.artworkHash}, ${excluded(albums.artworkHash)})`,
            compilation: sql`${albums.compilation} or ${excluded(albums.compilation)}`,
          },
        })
        .returning({ id: albums.id, key: albums.key })
        .all(),
    );

    const t = schema.tracks;
    tx.insert(t)
      .values(
        tracks.map((track) => ({
          path: track.path,
          folderId: requireId(folderIds, track.folder, "folder"),
          fileName: track.fileName,
          sizeBytes: track.sizeBytes,
          modifiedAt: track.modifiedAt,
          title: track.title,
          titleSort: track.titleSort,
          artistId: requireId(artistIds, track.artistKey, "artist"),
          albumId: requireId(albumIds, track.albumKey, "album"),
          genreId: track.genreKey === null ? null : (genreIds.get(track.genreKey) ?? null),
          year: track.year,
          trackNumber: track.trackNumber,
          trackTotal: track.trackTotal,
          discNumber: track.discNumber,
          discTotal: track.discTotal,
          durationMs: track.durationMs,
          sampleRate: track.sampleRate,
          bitrateKbps: track.bitrateKbps,
          artworkHash: track.artworkHash,
          addedAt: now,
          scannedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: t.path,
        // Everything but added_at, which keeps the first time the file was seen.
        set: {
          folderId: excluded(t.folderId),
          fileName: excluded(t.fileName),
          sizeBytes: excluded(t.sizeBytes),
          modifiedAt: excluded(t.modifiedAt),
          title: excluded(t.title),
          titleSort: excluded(t.titleSort),
          artistId: excluded(t.artistId),
          albumId: excluded(t.albumId),
          genreId: excluded(t.genreId),
          year: excluded(t.year),
          trackNumber: excluded(t.trackNumber),
          trackTotal: excluded(t.trackTotal),
          discNumber: excluded(t.discNumber),
          discTotal: excluded(t.discTotal),
          durationMs: excluded(t.durationMs),
          sampleRate: excluded(t.sampleRate),
          bitrateKbps: excluded(t.bitrateKbps),
          artworkHash: excluded(t.artworkHash),
          scannedAt: excluded(t.scannedAt),
        },
      })
      .run();
  });
};

/** SQLite's default limit on bound parameters is far above this; it keeps statements small. */
const DELETE_CHUNK = 500;

const removeRootSync = (db: Database, path: string): void => {
  const { scanRoots, tracks } = schema;
  db.transaction((tx) => {
    const remaining = tx
      .select({ path: scanRoots.path })
      .from(scanRoots)
      .all()
      .map((root) => root.path)
      .filter((root) => root !== path);
    if (remaining.length === 0) throw new Error("Wave needs at least one music folder");

    const under = tx
      .select({ path: tracks.path })
      .from(tracks)
      // SQLite counts characters where JS counts UTF-16 units, so the length is taken in SQL.
      .where(sql`substr(${tracks.path}, 1, length(${path}) + 1) = ${`${path}/`}`)
      .all()
      .map((row) => row.path);
    const leaving = filesLeavingWithRoot(under, path, remaining);
    for (let i = 0; i < leaving.length; i += DELETE_CHUNK) {
      tx.delete(tracks)
        .where(inArray(tracks.path, leaving.slice(i, i + DELETE_CHUNK)))
        .run();
    }
    tx.delete(scanRoots).where(eq(scanRoots.path, path)).run();

    // Albums first: they hold the album artist.
    tx.run(sql`DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks)`);
    tx.run(sql`DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM tracks)
      AND id NOT IN (SELECT album_artist_id FROM albums)`);
    tx.run(sql`DELETE FROM genres
      WHERE id NOT IN (SELECT genre_id FROM tracks WHERE genre_id IS NOT NULL)`);
    tx.run(sql`DELETE FROM folders WHERE id NOT IN (SELECT folder_id FROM tracks)`);
  });
};

const make = Effect.gen(function* () {
  const db: Database = yield* Effect.try({
    try: () => {
      const client = openDatabaseSync(DATABASE_NAME);
      client.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      return drizzle(client, { schema });
    },
    catch: (cause) => new LibraryStoreError({ operation: "open the database", cause }),
  });
  yield* Effect.tryPromise({
    try: () => migrate(db, migrations),
    catch: (cause) => new LibraryStoreError({ operation: "migrate", cause }),
  });

  const attempt = <A>(operation: string, run: () => A): Effect.Effect<A, LibraryStoreError> =>
    Effect.try({ try: run, catch: (cause) => new LibraryStoreError({ operation, cause }) });

  return LibraryStore.of({
    ensureDefaultRoot: (path) =>
      attempt("set up scan roots", () => {
        const existing = db.select().from(schema.scanRoots).all();
        if (existing.length > 0) return existing;
        db.insert(schema.scanRoots).values({ path, addedAt: Date.now(), isDefault: true }).run();
        return db.select().from(schema.scanRoots).all();
      }),

    listRoots: attempt("list music folders", () => {
      const { scanRoots, tracks } = schema;
      return db
        .select({
          path: scanRoots.path,
          isDefault: scanRoots.isDefault,
          lastScannedAt: scanRoots.lastScannedAt,
          trackCount: sql<number>`(SELECT count(*) FROM ${tracks}
            WHERE substr(${tracks.path}, 1, length(${scanRoots.path}) + 1) = ${scanRoots.path} || '/')`,
        })
        .from(scanRoots)
        .orderBy(asc(scanRoots.addedAt), asc(scanRoots.path))
        .all();
    }),

    addRoot: (path, drop) =>
      attempt("add a music folder", () =>
        db.transaction((tx) => {
          const { scanRoots } = schema;
          if (drop.length > 0)
            tx.delete(scanRoots)
              .where(inArray(scanRoots.path, [...drop]))
              .run();
          tx.insert(scanRoots).values({ path, addedAt: Date.now() }).onConflictDoNothing().run();
          tx.update(scanRoots).set({ isDefault: false }).run();
        }),
      ),

    removeRoot: (path) => attempt("remove a music folder", () => removeRootSync(db, path)),

    excludedFolders: attempt("read excluded folders", () =>
      db
        .select({ path: schema.excludedFolders.path })
        .from(schema.excludedFolders)
        .all()
        .map((row) => row.path),
    ),

    saveBatch: (tracks, artworkRows) =>
      attempt("save scanned tracks", () => saveBatchSync(db, tracks, artworkRows, Date.now())),

    markScanned: (roots, at) =>
      attempt("record the scan", () => {
        if (roots.length === 0) return;
        db.update(schema.scanRoots)
          .set({ lastScannedAt: at })
          .where(inArray(schema.scanRoots.path, [...roots]))
          .run();
      }),

    countTracks: attempt(
      "count tracks",
      () =>
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.tracks)
          .get()?.count ?? 0,
    ),

    listSongs: attempt("list songs", () =>
      db
        .select({
          id: schema.tracks.id,
          path: schema.tracks.path,
          title: schema.tracks.title,
          artist: schema.artists.name,
          album: schema.albums.title,
          durationMs: schema.tracks.durationMs,
          thumbPath: schema.artwork.thumbPath,
          artworkPath: schema.artwork.path,
        })
        .from(schema.tracks)
        .innerJoin(schema.artists, eq(schema.tracks.artistId, schema.artists.id))
        .innerJoin(schema.albums, eq(schema.tracks.albumId, schema.albums.id))
        .leftJoin(schema.artwork, eq(schema.tracks.artworkHash, schema.artwork.hash))
        .orderBy(asc(schema.tracks.titleSort), asc(schema.artists.sort), asc(schema.tracks.path))
        .all(),
    ),

    trackDetails: (id) =>
      attempt(
        "read the playing track",
        () =>
          db
            .select({
              id: schema.tracks.id,
              artistId: schema.tracks.artistId,
              artist: schema.artists.name,
              albumId: schema.tracks.albumId,
              album: schema.albums.title,
              palette: schema.artwork.palette,
            })
            .from(schema.tracks)
            .innerJoin(schema.artists, eq(schema.tracks.artistId, schema.artists.id))
            .innerJoin(schema.albums, eq(schema.tracks.albumId, schema.albums.id))
            .leftJoin(schema.artwork, eq(schema.tracks.artworkHash, schema.artwork.hash))
            .where(eq(schema.tracks.id, id))
            .get() ?? null,
      ),

    songsByIds: (ids) =>
      attempt("read queued songs", () => {
        const rows: SongRow[] = [];
        // Stays well under SQLite's bound-parameter limit for queues of any length.
        for (let start = 0; start < ids.length; start += SONGS_BY_IDS_CHUNK) {
          const chunk = ids.slice(start, start + SONGS_BY_IDS_CHUNK);
          rows.push(
            ...db
              .select({
                id: schema.tracks.id,
                path: schema.tracks.path,
                title: schema.tracks.title,
                artist: schema.artists.name,
                album: schema.albums.title,
                durationMs: schema.tracks.durationMs,
                thumbPath: schema.artwork.thumbPath,
                artworkPath: schema.artwork.path,
              })
              .from(schema.tracks)
              .innerJoin(schema.artists, eq(schema.tracks.artistId, schema.artists.id))
              .innerJoin(schema.albums, eq(schema.tracks.albumId, schema.albums.id))
              .leftJoin(schema.artwork, eq(schema.tracks.artworkHash, schema.artwork.hash))
              .where(inArray(schema.tracks.id, chunk))
              .all(),
          );
        }
        return rows;
      }),
  });
});

const SONGS_BY_IDS_CHUNK = 500;

export const layer = Layer.effect(LibraryStore, make);

/** Roots that have never finished a full scan. */
export const unscannedRoots = (roots: readonly ScanRoot[]): readonly ScanRoot[] =>
  roots.filter((root) => root.lastScannedAt === null);
