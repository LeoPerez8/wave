/**
 * Play history and the Home tab's sections, as queries over the library
 * database. Kept free of Expo so the store tests run them against a real
 * SQLite in plain Node (`testDatabase.ts`); `LibraryStore` calls them.
 */
import type { PlayEvent } from "@wave/core";
import { and, desc, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";

import type { AlbumRow, SongRow } from "../LibraryStore.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { playRecordingKey, stamped } from "./sync.ts";
import { selectAlbums } from "./albums.ts";
import { BY_TITLE, inScope, songColumns, type TrackScope } from "./tracks.ts";

/** A Most Played song with its number of counted plays. */
export interface MostPlayedRow extends SongRow {
  readonly playCount: number;
}

/** A starred song, with when it was starred (Favorites can be sorted by it). */
export interface FavoriteRow extends SongRow {
  readonly starredAt: number;
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

/**
 * Records a play as it starts, with its song's recording key, as the play
 * going on now (`ongoing`: the one before, if it never ended, is over);
 * returns its row id, to update it as it goes on.
 */
export const recordPlay = (db: LibraryDatabase, play: PlayEvent): number =>
  db.transaction((tx) => {
    const { playEvents } = schema;
    tx.update(playEvents).set({ ongoing: false }).where(eq(playEvents.ongoing, true)).run();
    return tx
      .insert(playEvents)
      .values({
        trackId: Number(play.trackId),
        recordingKey: playRecordingKey(Number(play.trackId)),
        startedAt: play.startedAt,
        contextType: play.context?.kind ?? null,
        contextId: play.context?.id ?? null,
        source: play.source,
        ongoing: true,
        ...progress(play),
      })
      .returning({ id: playEvents.id })
      .get().id;
  });

/** Brings a recorded play up to date: listened time, length, how it ended (so far), counted. */
export const updatePlay = (db: LibraryDatabase, id: number, play: PlayEvent): void => {
  db.update(schema.playEvents).set(progress(play)).where(eq(schema.playEvents.id, id)).run();
};

/** Records how a play ended: it no longer changes, so it can go to the Wave account. */
export const endPlay = (db: LibraryDatabase, id: number, play: PlayEvent): void => {
  db.update(schema.playEvents)
    .set({ ...progress(play), ongoing: false })
    .where(eq(schema.playEvents.id, id))
    .run();
};

/** A recorded play with its row id. */
export interface RecordedPlay {
  readonly id: number;
  readonly play: PlayEvent;
}

/**
 * The play going on, as it was last brought up to date; `PlayHistory` picks
 * it back up when JS restarts while the player kept going.
 */
export const latestPlay = (db: LibraryDatabase): RecordedPlay | null => {
  const row = db
    .select()
    .from(schema.playEvents)
    // Imported plays (BlackPlayer's) and plays from the Wave account never went on in this player.
    .where(and(isNull(schema.playEvents.importedFrom), eq(schema.playEvents.ongoing, true)))
    .orderBy(desc(schema.playEvents.id))
    .limit(1)
    .get();
  if (row === undefined) return null;
  return {
    id: row.id,
    play: {
      trackId: String(row.trackId),
      context:
        row.contextType === null ? null : { kind: row.contextType, id: row.contextId ?? null },
      startedAt: row.startedAt,
      listenedMs: row.listenedMs,
      durationMs: row.durationMs,
      endReason: row.endReason,
      counted: row.counted,
      source: row.source,
    },
  };
};

/** Albums by id with Tracks in [scope], with their track count and length, in the order of `ids`. */
const albumsInOrder = (
  db: LibraryDatabase,
  ids: readonly number[],
  scope: TrackScope,
): AlbumRow[] => {
  if (ids.length === 0) return [];
  const rows = selectAlbums(db, inArray(schema.albums.id, [...ids]), undefined, scope);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
};

const recentlyAddedAlbums = (db: LibraryDatabase, scope: TrackScope): AlbumRow[] => {
  const { tracks } = schema;
  const ids = db
    .select({ id: tracks.albumId })
    .from(tracks)
    .groupBy(tracks.albumId)
    .orderBy(desc(max(tracks.addedAt)), desc(tracks.albumId))
    .limit(SHELF)
    .all()
    .map((row) => row.id);
  return albumsInOrder(db, ids, scope);
};

const recentlyPlayedAlbums = (db: LibraryDatabase, scope: TrackScope): AlbumRow[] => {
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
  return albumsInOrder(db, ids, scope);
};

const mostPlayedSongs = (db: LibraryDatabase, scope: TrackScope): MostPlayedRow[] => {
  const { playEvents, tracks, artists, albums, artwork } = schema;
  const playCount = sql<number>`count(*)`;
  return db
    .select({ ...songColumns, playCount })
    .from(playEvents)
    .innerJoin(tracks, inScope(eq(playEvents.trackId, tracks.id), scope))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(eq(playEvents.counted, true))
    .groupBy(tracks.id)
    .orderBy(desc(playCount), desc(max(playEvents.startedAt)))
    .limit(LIST)
    .all();
};

const recentFavorites = (db: LibraryDatabase, scope: TrackScope): SongRow[] => {
  const { favorites, tracks, artists, albums, artwork } = schema;
  return db
    .select(songColumns)
    .from(favorites)
    .innerJoin(tracks, inScope(eq(favorites.trackId, tracks.id), scope))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(eq(favorites.deleted, false))
    .orderBy(desc(favorites.addedAt), desc(favorites.trackId))
    .limit(LIST)
    .all();
};

/** Library › Favorites: starred songs with when each was starred, the most recent first. */
export const listFavorites = (db: LibraryDatabase): FavoriteRow[] => {
  const { favorites, tracks, artists, albums, artwork } = schema;
  return db
    .select({ ...songColumns, starredAt: favorites.addedAt })
    .from(favorites)
    .innerJoin(tracks, eq(favorites.trackId, tracks.id))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(eq(favorites.deleted, false))
    .orderBy(desc(favorites.addedAt), ...BY_TITLE)
    .all();
};

/** The ids of every starred track (unstarred ones, tombstones, aren't). */
export const selectFavoriteTrackIds = (db: LibraryDatabase): number[] =>
  db
    .select({ trackId: schema.favorites.trackId })
    .from(schema.favorites)
    .where(eq(schema.favorites.deleted, false))
    .all()
    .map((row) => row.trackId);

/**
 * The recording key (Core's `recordingKey`) of every song ever played, each
 * once, including songs whose files have since left the Library. Discover
 * mixes leave them out.
 */
export const playedRecordingKeys = (db: LibraryDatabase): string[] =>
  db
    .selectDistinct({ key: schema.playEvents.recordingKey })
    .from(schema.playEvents)
    .where(isNotNull(schema.playEvents.recordingKey))
    .all()
    .flatMap((row) => (row.key === null ? [] : [row.key]));

/** SQLite caps the variables in one statement; batches stay well under it. */
const BATCH = 500;

/**
 * Stars ([on]) or unstars many tracks in one transaction, stamping each star
 * that changes (`changeStamp`). Tracks starred already keep when they were
 * starred; unstarring leaves the star as a tombstone, and starring again
 * brings it back.
 */
export const setFavorites = (
  db: LibraryDatabase,
  trackIds: readonly number[],
  on: boolean,
  now: number,
): void => {
  const { favorites } = schema;
  db.transaction((tx) => {
    for (let start = 0; start < trackIds.length; start += BATCH) {
      const batch = trackIds.slice(start, start + BATCH);
      if (on)
        tx.insert(favorites)
          .values(batch.map((trackId) => ({ trackId, addedAt: now, changedAt: now })))
          .onConflictDoUpdate({
            target: favorites.trackId,
            set: { addedAt: now, deleted: false, ...stamped(favorites, now) },
            setWhere: eq(favorites.deleted, true),
          })
          .run();
      else
        tx.update(favorites)
          .set({ deleted: true, ...stamped(favorites, now) })
          .where(and(inArray(favorites.trackId, batch), eq(favorites.deleted, false)))
          .run();
    }
  });
};

/** The Home tab's sections, of the Tracks in [scope] (Android Auto's Home: those with a file). */
export const homeSections = (db: LibraryDatabase, scope: TrackScope = "library"): HomeSections => ({
  recentlyAdded: recentlyAddedAlbums(db, scope),
  recentlyPlayed: recentlyPlayedAlbums(db, scope),
  mostPlayed: mostPlayedSongs(db, scope),
  favorites: recentFavorites(db, scope),
});
