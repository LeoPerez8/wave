import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { filesLeavingWithRoot, rememberSearch } from "@wave/core";
import type { LibraryDatabase } from "./database.ts";
import type { ArtistRow, GenreDetail } from "../types.ts";
import type { CreditSplits } from "./credits.ts";
import * as schema from "./schema.ts";
import { filePath, hasFile, trackArtistIds, withFile, trackQuery, BY_TITLE } from "./tracks.ts";
import { leaveFiles } from "./missingSongs.ts";
import { pruneOrphans } from "./save.ts";
import { selectArtists } from "./artists.ts";
import { selectGenreSongs } from "./genres.ts";
import { selectAlbums } from "./albums.ts";
import { linkPlaylistEntries } from "./playlists.ts";
type Database = LibraryDatabase;

/** SQLite's default limit on bound parameters is far above this; it keeps statements small. */
const DELETE_CHUNK = 500;

const chunks = <A>(items: readonly A[]): A[][] => {
  const result: A[][] = [];
  for (let i = 0; i < items.length; i += DELETE_CHUNK) {
    result.push(items.slice(i, i + DELETE_CHUNK));
  }
  return result;
};

export const removeRootSync = (db: Database, splits: CreditSplits, path: string): void => {
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
      .select({ path: filePath })
      .from(tracks)
      // SQLite counts characters where JS counts UTF-16 units, so the length is taken in SQL.
      .where(and(hasFile, sql`substr(${tracks.path}, 1, length(${path}) + 1) = ${`${path}/`}`))
      .all()
      .map((row) => row.path);
    const leaving = filesLeavingWithRoot(under, path, remaining);
    leaveFiles(tx, leaving, Date.now());
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

    pruneOrphans(tx, splits);
  });
};

/** Artists with songs (see `selectArtists`), only [ids] if given. */
export const listArtistsSync = (db: Database, ids?: readonly number[]): ArtistRow[] =>
  selectArtists(db, { ids });

export const getGenreSync = (db: Database, id: number): GenreDetail | null => {
  const { genres } = schema;
  const genre = db
    .select({ id: genres.id, name: genres.name, sort: genres.sort })
    .from(genres)
    .where(eq(genres.id, id))
    .get();
  if (genre === undefined) return null;
  const songs = selectGenreSongs(db, id);
  return { genre: { ...genre, trackCount: songs.length }, songs };
};

export const listRecentSearchesSync = (db: Pick<Database, "select">): string[] =>
  db
    .select({ query: schema.recentSearches.query })
    .from(schema.recentSearches)
    .orderBy(desc(schema.recentSearches.searchedAt))
    .all()
    .map((row) => row.query);

/** Rewrites the list Core's `rememberSearch` returns, newest with the latest time. */
export const rememberSearchSync = (db: Database, query: string, now: number): readonly string[] =>
  db.transaction((tx) => {
    const recent = listRecentSearchesSync(tx);
    const next = rememberSearch(recent, query);
    if (next === recent) return recent;
    tx.delete(schema.recentSearches).run();
    tx.insert(schema.recentSearches)
      .values(next.map((search, i) => ({ query: search, searchedAt: now - i })))
      .run();
    return next;
  });

export const ensureDefaultRoot = (db: Database, path: string) => {
  const existing = db.select().from(schema.scanRoots).all();
  if (existing.length > 0) return existing;
  db.insert(schema.scanRoots).values({ path, addedAt: Date.now(), isDefault: true }).run();
  return db.select().from(schema.scanRoots).all();
};

export const listRoots = (db: Database) => {
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
};

export const addRoot = (db: Database, path: string, drop: readonly string[]) =>
  db.transaction((tx) => {
    const { scanRoots } = schema;
    if (drop.length > 0)
      tx.delete(scanRoots)
        .where(inArray(scanRoots.path, [...drop]))
        .run();
    tx.insert(scanRoots).values({ path, addedAt: Date.now() }).onConflictDoNothing().run();
    tx.update(scanRoots).set({ isDefault: false }).run();
  });

export const addExcludedFolder = (db: Database, path: string, drop: readonly string[]) =>
  db.transaction((tx) => {
    const { excludedFolders } = schema;
    if (drop.length > 0)
      tx.delete(excludedFolders)
        .where(inArray(excludedFolders.path, [...drop]))
        .run();
    tx.insert(excludedFolders).values({ path, addedAt: Date.now() }).onConflictDoNothing().run();
  });

export const excludedFolders = (db: Database) =>
  db
    .select({ path: schema.excludedFolders.path })
    .from(schema.excludedFolders)
    .all()
    .map((row) => row.path);

export const countTracks = (db: Database) =>
  db
    .select({ count: sql<number>`count(*)` })
    .from(schema.tracks)
    .get()?.count ?? 0;

export const trackDetails = (db: Database, id: number) =>
  db
    .select({
      id: schema.tracks.id,
      artistId: schema.tracks.artistId,
      artistIds: trackArtistIds,
      artist: schema.tracks.artistCredit,
      albumId: schema.tracks.albumId,
      album: schema.albums.title,
      palette: schema.artwork.palette,
      path: filePath,
    })
    .from(schema.tracks)
    .innerJoin(schema.artists, withFile(eq(schema.tracks.artistId, schema.artists.id)))
    .innerJoin(schema.albums, eq(schema.tracks.albumId, schema.albums.id))
    .leftJoin(schema.artwork, eq(schema.tracks.artworkHash, schema.artwork.hash))
    .where(eq(schema.tracks.id, id))
    .get() ?? null;

/** The colours read from a cover, by its artwork path; null for a path Wave holds no colours for. */
export const artworkPalette = (db: Database, path: string) =>
  db
    .select({ palette: schema.artwork.palette })
    .from(schema.artwork)
    .where(eq(schema.artwork.path, path))
    .get()?.palette ?? null;

export const indexedFiles = (db: Database, paths: readonly string[]) =>
  chunks(paths).flatMap((chunk) =>
    db
      .select({
        path: filePath,
        sizeBytes: schema.tracks.sizeBytes,
        durationMs: schema.tracks.durationMs,
        title: schema.tracks.title,
        artist: schema.tracks.artistCredit,
      })
      .from(schema.tracks)
      .innerJoin(schema.artists, eq(schema.tracks.artistId, schema.artists.id))
      .where(and(hasFile, inArray(schema.tracks.path, chunk)))
      .all(),
  );

export const databaseWrites = (db: Database): string => {
  const row = db.get<{ writes: number; external: number }>(sql`
      SELECT total_changes() AS writes, data_version AS external FROM pragma_data_version`)!;
  return `${row.writes}:${row.external}`;
};

export const markScanned = (db: Database, roots: readonly string[], at: number): void => {
  db.update(schema.scanRoots)
    .set({ lastScannedAt: at })
    .where(inArray(schema.scanRoots.path, [...roots]))
    .run();
};

export const removeExcludedFolder = (db: Database, path: string): void => {
  db.delete(schema.excludedFolders).where(eq(schema.excludedFolders.path, path)).run();
};
export const clearRecentSearches = (db: Database): void => {
  db.delete(schema.recentSearches).run();
};
export const albumsByIds = (db: Database, ids: readonly number[]) =>
  ids.length === 0 ? [] : selectAlbums(db, inArray(schema.albums.id, [...ids]));
export const linkEntries = (db: Database, at: number) =>
  db.transaction((tx) => linkPlaylistEntries(tx, at));

export const listGenres = (db: Database) => {
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
};

export const listSongs = (db: Database) =>
  trackQuery(db)
    .orderBy(...BY_TITLE)
    .all();
