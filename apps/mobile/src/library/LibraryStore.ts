import {
  artistAlbums,
  compareAlbumTracks,
  compareFileNames,
  filesLeavingWithRoot,
  sortKey,
  type IndexedFile,
  type LibraryTrack,
} from "@wave/core";
import { asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
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
import type { KnownFile } from "./NativeScanner";

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
  /** Core sort key of the title (files the row on the A–Z spine). */
  readonly titleSort: string;
  readonly albumId: number;
  /** The track artist. */
  readonly artistId: number;
}

/** A track on an album screen, with what orders it there. */
export interface AlbumTrackRow extends SongRow {
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
}

/** One album of the Albums grid (and of an artist's albums). */
export interface AlbumRow {
  readonly id: number;
  readonly title: string;
  readonly titleSort: string;
  readonly albumArtist: string;
  readonly albumArtistId: number;
  readonly year: number | null;
  readonly compilation: boolean;
  readonly trackCount: number;
  readonly durationMs: number;
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
}

/** One row of the Artists list: track artists and album artists alike. */
export interface ArtistRow {
  readonly id: number;
  readonly name: string;
  readonly sort: string;
  /** Albums filed under the artist. */
  readonly albumCount: number;
  /** Songs by the artist or on their albums. */
  readonly trackCount: number;
}

export interface GenreRow {
  readonly id: number;
  readonly name: string;
  readonly sort: string;
  readonly trackCount: number;
}

/** A folder that holds tracks, for Library › Folders. */
export interface FolderRow {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  /** Core sort key of the name. */
  readonly sort: string;
  readonly trackCount: number;
}

export interface AlbumDetail {
  readonly album: AlbumRow;
  /** The genre most of the album's tracks carry. */
  readonly genre: string | null;
  /** By disc, then track number (Core's `compareAlbumTracks`). */
  readonly tracks: readonly AlbumTrackRow[];
}

export interface ArtistDetail {
  readonly artist: ArtistRow;
  /** Filed under the artist, newest first. */
  readonly albums: readonly AlbumRow[];
  /** Other albums with songs by the artist (compilations…), newest first. */
  readonly appearsOn: readonly AlbumRow[];
  /** By title. */
  readonly songs: readonly SongRow[];
}

export interface GenreDetail {
  readonly genre: GenreRow;
  /** By title. */
  readonly songs: readonly SongRow[];
}

export interface FolderDetail {
  readonly folder: FolderRow;
  /** By file name, the way a file manager lists them. */
  readonly songs: readonly SongRow[];
}

/** An indexed file found under a new path (see Core's `reconcileScan`). */
export interface PathMove {
  readonly from: string;
  readonly to: string;
}

/** The queue and position saved for the next launch. */
export interface SavedPlayback {
  /** Core's `QueueState` as JSON. */
  readonly queue: string;
  readonly positionMs: number;
}

/** What Now Playing shows about a track beyond the player's item. */
export interface TrackDetails {
  readonly id: number;
  readonly artistId: number;
  readonly artist: string;
  readonly albumId: number;
  readonly album: string;
  readonly palette: schema.ArtworkPalette | null;
  /** The audio file, for reading its lyrics. */
  readonly path: string;
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
    /**
     * Upserts one scanner batch (and the artwork it references) in a single
     * transaction. [moves] first re-point indexed tracks to the paths they were
     * found under, so they keep their id (and with it history and favorites).
     */
    readonly saveBatch: (
      tracks: readonly IndexedTrack[],
      artwork: readonly IndexedArtwork[],
      moves?: readonly PathMove[],
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly markScanned: (
      roots: readonly string[],
      at: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly countTracks: Effect.Effect<number, LibraryStoreError>;
    /** Every track ordered by title, for Library › Songs. */
    readonly listSongs: Effect.Effect<readonly SongRow[], LibraryStoreError>;
    /** Every album by title, then album artist, for Library › Albums. */
    readonly listAlbums: Effect.Effect<readonly AlbumRow[], LibraryStoreError>;
    /** Every artist with songs, by name, for Library › Artists. */
    readonly listArtists: Effect.Effect<readonly ArtistRow[], LibraryStoreError>;
    /** Every genre with songs, by name, for Library › Genres. */
    readonly listGenres: Effect.Effect<readonly GenreRow[], LibraryStoreError>;
    /** Every folder holding songs, by name, for Library › Folders. */
    readonly listFolders: Effect.Effect<readonly FolderRow[], LibraryStoreError>;
    /** An album and its tracks, or null when it's no longer in the library. */
    readonly getAlbum: (id: number) => Effect.Effect<AlbumDetail | null, LibraryStoreError>;
    readonly getArtist: (id: number) => Effect.Effect<ArtistDetail | null, LibraryStoreError>;
    readonly getGenre: (id: number) => Effect.Effect<GenreDetail | null, LibraryStoreError>;
    readonly getFolder: (id: number) => Effect.Effect<FolderDetail | null, LibraryStoreError>;

    /** The indexed files under [roots], for an incremental scan to skip the unchanged ones. */
    readonly knownFiles: (
      roots: readonly string[],
    ) => Effect.Effect<readonly KnownFile[], LibraryStoreError>;
    /** What identifies the indexed files at [paths] when they turn up elsewhere. */
    readonly indexedFiles: (
      paths: readonly string[],
    ) => Effect.Effect<readonly IndexedFile[], LibraryStoreError>;
    /**
     * Removes the tracks at [paths], then the albums, artists, genres and
     * folders left without tracks (also after tag changes, so call it once per scan).
     */
    readonly removeTracks: (paths: readonly string[]) => Effect.Effect<void, LibraryStoreError>;
    /** Excludes [path] and drops the exclusions in [drop] (see Core's `planExclusion`). */
    readonly addExcludedFolder: (
      path: string,
      drop: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly removeExcludedFolder: (path: string) => Effect.Effect<void, LibraryStoreError>;
    /** The tracks with these ids, in no particular order; ids no longer indexed are left out. */
    readonly songsByIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly SongRow[], LibraryStoreError>;
    readonly loadPlayback: Effect.Effect<SavedPlayback | null, LibraryStoreError>;
    /** Saves the queue with where its current entry is. */
    readonly saveQueue: (
      queue: string,
      positionMs: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly savePosition: (positionMs: number) => Effect.Effect<void, LibraryStoreError>;
    /** The playing track's links and artwork palette, for Now Playing; null once it's gone. */
    readonly trackDetails: (id: number) => Effect.Effect<TrackDetails | null, LibraryStoreError>;
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
  moves: readonly PathMove[],
  now: number,
): void => {
  const { artists, genres, folders, albums, artwork } = schema;
  db.transaction((tx) => {
    // The upsert below then updates the moved rows by their new path.
    for (const move of moves) {
      tx.update(schema.tracks)
        .set({ path: move.to })
        .where(eq(schema.tracks.path, move.from))
        .run();
    }
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

const chunks = <A>(items: readonly A[]): A[][] => {
  const result: A[][] = [];
  for (let i = 0; i < items.length; i += DELETE_CHUNK) {
    result.push(items.slice(i, i + DELETE_CHUNK));
  }
  return result;
};

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Deletes the albums, artists, genres and folders no track uses any more. */
const pruneOrphans = (tx: Transaction): void => {
  // Albums first: they hold the album artist.
  tx.run(sql`DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks)`);
  tx.run(sql`DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM tracks)
    AND id NOT IN (SELECT album_artist_id FROM albums)`);
  tx.run(sql`DELETE FROM genres
    WHERE id NOT IN (SELECT genre_id FROM tracks WHERE genre_id IS NOT NULL)`);
  tx.run(sql`DELETE FROM folders WHERE id NOT IN (SELECT folder_id FROM tracks)`);
};

const removeTracksSync = (db: Database, paths: readonly string[]): void => {
  db.transaction((tx) => {
    for (const chunk of chunks(paths)) {
      tx.delete(schema.tracks).where(inArray(schema.tracks.path, chunk)).run();
    }
    pruneOrphans(tx);
  });
};

const removeRootSync = (db: Database, path: string): void => {
  const { scanRoots, tracks, excludedFolders } = schema;
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
    for (const chunk of chunks(leaving)) {
      tx.delete(tracks).where(inArray(tracks.path, chunk)).run();
    }
    tx.delete(scanRoots).where(eq(scanRoots.path, path)).run();

    // Exclusions only mean something inside a root.
    const exclusions = tx
      .select({ path: excludedFolders.path })
      .from(excludedFolders)
      .all()
      .map((row) => row.path);
    const stale = filesLeavingWithRoot(exclusions, path, remaining);
    if (stale.length > 0) {
      tx.delete(excludedFolders)
        .where(inArray(excludedFolders.path, [...stale]))
        .run();
    }

    pruneOrphans(tx);
  });
};

/** Tracks with what every track list shows (a `SongRow`), plus what orders albums and folders. */
const trackQuery = (db: Database) => {
  const { tracks, artists, albums, artwork } = schema;
  return db
    .select({
      id: tracks.id,
      path: tracks.path,
      title: tracks.title,
      artist: artists.name,
      album: albums.title,
      durationMs: tracks.durationMs,
      thumbPath: artwork.thumbPath,
      artworkPath: artwork.path,
      titleSort: tracks.titleSort,
      albumId: tracks.albumId,
      artistId: tracks.artistId,
      discNumber: tracks.discNumber,
      trackNumber: tracks.trackNumber,
      fileName: tracks.fileName,
    })
    .from(tracks)
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash));
};

/** Albums with their track count and length; albums left without tracks don't appear. */
const albumQuery = (db: Database, where: SQL | undefined): AlbumRow[] => {
  const { tracks, artists, albums, artwork } = schema;
  return db
    .select({
      id: albums.id,
      title: albums.title,
      titleSort: albums.titleSort,
      albumArtist: artists.name,
      albumArtistId: albums.albumArtistId,
      year: albums.year,
      compilation: albums.compilation,
      trackCount: sql<number>`count(${tracks.id})`,
      durationMs: sql<number>`coalesce(sum(${tracks.durationMs}), 0)`,
      thumbPath: artwork.thumbPath,
      artworkPath: artwork.path,
    })
    .from(albums)
    .innerJoin(artists, eq(albums.albumArtistId, artists.id))
    .innerJoin(tracks, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(albums.artworkHash, artwork.hash))
    .where(where)
    .groupBy(albums.id)
    .orderBy(asc(albums.titleSort), asc(artists.sort), asc(albums.id))
    .all();
};

const BY_TITLE = [
  asc(schema.tracks.titleSort),
  asc(schema.artists.sort),
  asc(schema.tracks.path),
] as const;

/**
 * Artists with songs: a song belongs to its track artist and to the album
 * artist of its album (so Watch the Throne counts for Kanye West as well).
 */
const listArtistsSync = (db: Database): ArtistRow[] =>
  db.all<ArtistRow>(sql`
    WITH links AS (
      SELECT id AS track_id, artist_id FROM tracks
      UNION
      SELECT tracks.id, albums.album_artist_id FROM tracks JOIN albums ON albums.id = tracks.album_id
    )
    SELECT artists.id AS "id", artists.name AS "name", artists.sort AS "sort",
      (SELECT count(*) FROM albums WHERE albums.album_artist_id = artists.id) AS "albumCount",
      count(links.track_id) AS "trackCount"
    FROM artists JOIN links ON links.artist_id = artists.id
    GROUP BY artists.id
    ORDER BY artists.sort, artists.id`);

const getAlbumSync = (db: Database, id: number): AlbumDetail | null => {
  const { tracks, genres } = schema;
  const album = albumQuery(db, eq(schema.albums.id, id))[0];
  if (album === undefined) return null;
  const genre = db
    .select({ name: genres.name })
    .from(tracks)
    .innerJoin(genres, eq(tracks.genreId, genres.id))
    .where(eq(tracks.albumId, id))
    .groupBy(genres.id)
    .orderBy(desc(sql`count(*)`), asc(genres.sort))
    .get();
  const rows = trackQuery(db).where(eq(tracks.albumId, id)).all();
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  return { album, genre: genre?.name ?? null, tracks: rows.sort(compareAlbumTracks) };
};

const getArtistSync = (db: Database, id: number): ArtistDetail | null => {
  const { artists, albums, tracks } = schema;
  const artist = db
    .select({ id: artists.id, name: artists.name, sort: artists.sort })
    .from(artists)
    .where(eq(artists.id, id))
    .get();
  if (artist === undefined) return null;
  const songs = trackQuery(db)
    .where(
      or(
        eq(tracks.artistId, id),
        inArray(
          tracks.albumId,
          db.select({ id: albums.id }).from(albums).where(eq(albums.albumArtistId, id)),
        ),
      ),
    )
    .orderBy(...BY_TITLE)
    .all();
  const split = artistAlbums(
    id,
    albumQuery(
      db,
      or(
        eq(albums.albumArtistId, id),
        inArray(
          albums.id,
          db.select({ id: tracks.albumId }).from(tracks).where(eq(tracks.artistId, id)),
        ),
      ),
    ),
  );
  return {
    artist: { ...artist, albumCount: split.albums.length, trackCount: songs.length },
    albums: split.albums,
    appearsOn: split.appearsOn,
    songs,
  };
};

const getGenreSync = (db: Database, id: number): GenreDetail | null => {
  const { genres, tracks } = schema;
  const genre = db
    .select({ id: genres.id, name: genres.name, sort: genres.sort })
    .from(genres)
    .where(eq(genres.id, id))
    .get();
  if (genre === undefined) return null;
  const songs = trackQuery(db)
    .where(eq(tracks.genreId, id))
    .orderBy(...BY_TITLE)
    .all();
  return { genre: { ...genre, trackCount: songs.length }, songs };
};

const getFolderSync = (db: Database, id: number): FolderDetail | null => {
  const { folders, tracks } = schema;
  const folder = db
    .select({ id: folders.id, name: folders.name, path: folders.path })
    .from(folders)
    .where(eq(folders.id, id))
    .get();
  if (folder === undefined) return null;
  const songs = trackQuery(db)
    .where(eq(tracks.folderId, id))
    .all()
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort((a, b) => compareFileNames(a.fileName, b.fileName));
  return {
    folder: { ...folder, sort: sortKey(folder.name), trackCount: songs.length },
    songs,
  };
};

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const listFoldersSync = (db: Database): FolderRow[] => {
  const { folders, tracks } = schema;
  return (
    db
      .select({
        id: folders.id,
        name: folders.name,
        path: folders.path,
        trackCount: sql<number>`count(${tracks.id})`,
      })
      .from(folders)
      .innerJoin(tracks, eq(tracks.folderId, folders.id))
      .groupBy(folders.id)
      .all()
      .map((folder) => ({ ...folder, sort: sortKey(folder.name) }))
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      .sort((a, b) => compareStrings(a.sort, b.sort) || compareStrings(a.path, b.path))
  );
};

const SAVED_PLAYBACK_ID = 1;

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

    saveBatch: (tracks, artworkRows, moves = []) =>
      attempt("save scanned tracks", () =>
        saveBatchSync(db, tracks, artworkRows, moves, Date.now()),
      ),

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
      trackQuery(db)
        .orderBy(...BY_TITLE)
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
              path: schema.tracks.path,
            })
            .from(schema.tracks)
            .innerJoin(schema.artists, eq(schema.tracks.artistId, schema.artists.id))
            .innerJoin(schema.albums, eq(schema.tracks.albumId, schema.albums.id))
            .leftJoin(schema.artwork, eq(schema.tracks.artworkHash, schema.artwork.hash))
            .where(eq(schema.tracks.id, id))
            .get() ?? null,
      ),

    listAlbums: attempt("list albums", () => albumQuery(db, undefined)),

    listArtists: attempt("list artists", () => listArtistsSync(db)),

    listGenres: attempt("list genres", () => {
      const { genres, tracks } = schema;
      return db
        .select({
          id: genres.id,
          name: genres.name,
          sort: genres.sort,
          trackCount: sql<number>`count(${tracks.id})`,
        })
        .from(genres)
        .innerJoin(tracks, eq(tracks.genreId, genres.id))
        .groupBy(genres.id)
        .orderBy(asc(genres.sort), asc(genres.id))
        .all();
    }),

    listFolders: attempt("list folders", () => listFoldersSync(db)),

    getAlbum: (id) => attempt("open the album", () => getAlbumSync(db, id)),

    getArtist: (id) => attempt("open the artist", () => getArtistSync(db, id)),

    getGenre: (id) => attempt("open the genre", () => getGenreSync(db, id)),

    getFolder: (id) => attempt("open the folder", () => getFolderSync(db, id)),

    knownFiles: (roots) =>
      attempt("read the library index", () => {
        if (roots.length === 0) return [];
        const { tracks } = schema;
        const under = roots.map(
          (root) => sql`substr(${tracks.path}, 1, length(${root}) + 1) = ${`${root}/`}`,
        );
        return db
          .select({
            path: tracks.path,
            sizeBytes: tracks.sizeBytes,
            modifiedAt: tracks.modifiedAt,
          })
          .from(tracks)
          .where(sql.join(under, sql` OR `))
          .all();
      }),

    indexedFiles: (paths) =>
      attempt("read missing files", () =>
        chunks(paths).flatMap((chunk) =>
          db
            .select({
              path: schema.tracks.path,
              sizeBytes: schema.tracks.sizeBytes,
              durationMs: schema.tracks.durationMs,
              title: schema.tracks.title,
              artist: schema.artists.name,
            })
            .from(schema.tracks)
            .innerJoin(schema.artists, eq(schema.tracks.artistId, schema.artists.id))
            .where(inArray(schema.tracks.path, chunk))
            .all(),
        ),
      ),

    removeTracks: (paths) => attempt("remove missing songs", () => removeTracksSync(db, paths)),

    addExcludedFolder: (path, drop) =>
      attempt("exclude a folder", () =>
        db.transaction((tx) => {
          const { excludedFolders } = schema;
          if (drop.length > 0)
            tx.delete(excludedFolders)
              .where(inArray(excludedFolders.path, [...drop]))
              .run();
          tx.insert(excludedFolders)
            .values({ path, addedAt: Date.now() })
            .onConflictDoNothing()
            .run();
        }),
      ),

    removeExcludedFolder: (path) =>
      attempt("include a folder again", () => {
        db.delete(schema.excludedFolders).where(eq(schema.excludedFolders.path, path)).run();
      }),

    songsByIds: (ids) =>
      attempt("read queued songs", () =>
        chunks(ids).flatMap((chunk) =>
          trackQuery(db).where(inArray(schema.tracks.id, chunk)).all(),
        ),
      ),

    loadPlayback: attempt(
      "read the saved queue",
      () =>
        db
          .select({
            queue: schema.savedPlayback.queue,
            positionMs: schema.savedPlayback.positionMs,
          })
          .from(schema.savedPlayback)
          .where(eq(schema.savedPlayback.id, SAVED_PLAYBACK_ID))
          .get() ?? null,
    ),

    saveQueue: (queue, positionMs) =>
      attempt("save the queue", () => {
        const row = { queue, positionMs: Math.round(positionMs), updatedAt: Date.now() };
        db.insert(schema.savedPlayback)
          .values({ id: SAVED_PLAYBACK_ID, ...row })
          .onConflictDoUpdate({ target: schema.savedPlayback.id, set: row })
          .run();
      }),

    savePosition: (positionMs) =>
      attempt("save the playback position", () => {
        db.update(schema.savedPlayback)
          .set({ positionMs: Math.round(positionMs), updatedAt: Date.now() })
          .where(eq(schema.savedPlayback.id, SAVED_PLAYBACK_ID))
          .run();
      }),
  });
});

export const layer = Layer.effect(LibraryStore, make);
