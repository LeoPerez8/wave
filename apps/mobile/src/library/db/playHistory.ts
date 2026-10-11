/**
 * Play history and the Home tab's sections, as queries over the library
 * database. Kept free of Expo so the store tests run them against a real
 * SQLite in plain Node (`testDatabase.ts`); `LibraryStore` calls them.
 */
import type { PlayEvent } from "@wave/core";
import { desc, eq, inArray, max, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type { AlbumRow, SongRow } from "../LibraryStore.ts";
import * as schema from "./schema.ts";

/** The library database, on the phone (expo-sqlite) or in tests (sql.js). */
export type LibraryDatabase = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

/** A Most Played song with its number of counted plays. */
export interface MostPlayedRow extends SongRow {
  readonly playCount: number;
}

export interface HomeSections {
  /** Albums by when their newest song entered the library, newest first. */
  readonly recentlyAdded: readonly AlbumRow[];
  /** Albums of the tracks played, the most recently played first. */
  readonly recentlyPlayed: readonly AlbumRow[];
  /** Songs by counted plays (Core's rule), then by their latest counted play. */
  readonly mostPlayed: readonly MostPlayedRow[];
  /** Starred songs, the most recently starred first. */
  readonly favorites: readonly SongRow[];
}

/** How many albums each Home shelf shows. */
const SHELF = 12;
/** How many songs each Home list shows. */
const LIST = 10;

/** What can change about a play while it goes on. */
const progress = (play: PlayEvent) => ({
  listenedMs: Math.round(play.listenedMs),
  durationMs: play.durationMs === null ? null : Math.round(play.durationMs),
  endReason: play.endReason,
  counted: play.counted,
});

/** Records a play as it starts; returns its row id, to update it as it goes on. */
export const recordPlay = (db: LibraryDatabase, play: PlayEvent): number =>
  db
    .insert(schema.playEvents)
    .values({
      trackId: Number(play.trackId),
      startedAt: play.startedAt,
      contextType: play.context?.kind ?? null,
      contextId: play.context?.id ?? null,
      ...progress(play),
    })
    .returning({ id: schema.playEvents.id })
    .get().id;

/** Brings a recorded play up to date: listened time, length, how it ended (so far), counted. */
export const updatePlay = (db: LibraryDatabase, id: number, play: PlayEvent): void => {
  db.update(schema.playEvents).set(progress(play)).where(eq(schema.playEvents.id, id)).run();
};

/** Albums by id, with their track count and length, in the order of `ids`. */
const albumsInOrder = (db: LibraryDatabase, ids: readonly number[]): AlbumRow[] => {
  if (ids.length === 0) return [];
  const { tracks, artists, albums, artwork } = schema;
  const rows = db
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
    .where(inArray(albums.id, [...ids]))
    .groupBy(albums.id)
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
};

const recentlyAddedAlbums = (db: LibraryDatabase): AlbumRow[] => {
  const { tracks } = schema;
  const ids = db
    .select({ id: tracks.albumId })
    .from(tracks)
    .groupBy(tracks.albumId)
    .orderBy(desc(max(tracks.addedAt)), desc(tracks.albumId))
    .limit(SHELF)
    .all()
    .map((row) => row.id);
  return albumsInOrder(db, ids);
};

const recentlyPlayedAlbums = (db: LibraryDatabase): AlbumRow[] => {
  const { playEvents, tracks } = schema;
  const ids = db
    .select({ id: tracks.albumId })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .groupBy(tracks.albumId)
    .orderBy(desc(max(playEvents.startedAt)))
    .limit(SHELF)
    .all()
    .map((row) => row.id);
  return albumsInOrder(db, ids);
};

/** What every track list shows (a `SongRow`). */
const songColumns = {
  id: schema.tracks.id,
  path: schema.tracks.path,
  title: schema.tracks.title,
  artist: schema.artists.name,
  album: schema.albums.title,
  durationMs: schema.tracks.durationMs,
  thumbPath: schema.artwork.thumbPath,
  artworkPath: schema.artwork.path,
  titleSort: schema.tracks.titleSort,
  albumId: schema.tracks.albumId,
  artistId: schema.tracks.artistId,
};

const mostPlayedSongs = (db: LibraryDatabase): MostPlayedRow[] => {
  const { playEvents, tracks, artists, albums, artwork } = schema;
  const playCount = sql<number>`count(*)`;
  return db
    .select({ ...songColumns, playCount })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(eq(playEvents.counted, true))
    .groupBy(tracks.id)
    .orderBy(desc(playCount), desc(max(playEvents.startedAt)))
    .limit(LIST)
    .all();
};

const recentFavorites = (db: LibraryDatabase): SongRow[] => {
  const { favorites, tracks, artists, albums, artwork } = schema;
  return db
    .select(songColumns)
    .from(favorites)
    .innerJoin(tracks, eq(favorites.trackId, tracks.id))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .orderBy(desc(favorites.addedAt), desc(favorites.trackId))
    .limit(LIST)
    .all();
};

export const homeSections = (db: LibraryDatabase): HomeSections => ({
  recentlyAdded: recentlyAddedAlbums(db),
  recentlyPlayed: recentlyPlayedAlbums(db),
  mostPlayed: mostPlayedSongs(db),
  favorites: recentFavorites(db),
});
