/**
 * What the Library store keeps for the Wave account (docs/spec.md, "Wave
 * account and sync"): this install's phone id, each Track's recording key and
 * video id, and the change stamps of playlists, entries, favorites and
 * preferences, read back as the rows that changed since a time. Nothing
 * syncs here. Kept free of Expo so the store tests run it against a real
 * SQLite (`testDatabase.ts`).
 */
import { recordingKey } from "@wave/core";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { thisPhoneId } from "./schema.ts";

/** This install's phone id: random, made with the store, never changed. */
export const selectPhoneId = (db: LibraryDatabase): string => {
  const row = db.select({ phoneId: schema.phone.phoneId }).from(schema.phone).get();
  if (row === undefined) throw new Error("The store has no phone id");
  return row.phoneId;
};

/**
 * The stamp of a change this phone makes at [now] to rows of [table] (a
 * playlist, an entry, a star, a preference): this phone, and [now], or just after the
 * row's last change if that's later, so no two changes of a row share a time.
 */
export const stamped = (table: { readonly changedAt: SQLiteColumn }, now: number) => ({
  changedAt: sql<number>`max(${now}, ${table.changedAt} + 1)`,
  phoneId: thisPhoneId(),
});

/**
 * Records that this phone changed the synced preference [key] (its
 * key-value store key) at [now]. The value stays in the key-value store.
 */
export const stampPreference = (db: LibraryDatabase, key: string, now: number): void => {
  const { preferenceChanges } = schema;
  db.insert(preferenceChanges)
    .values({ key, changedAt: now })
    .onConflictDoUpdate({ target: preferenceChanges.key, set: stamped(preferenceChanges, now) })
    .run();
};

/** Track ids per statement, well under SQLite's limit on bound values. */
const CHUNK = 500;

/**
 * Gives every Track without a recording key its key (Core's `recordingKey`,
 * from its title, album, album artist credit, disc and track number), then
 * gives the plays of those Tracks theirs. Only the update that brought
 * recording keys in leaves Tracks without one, so this does nothing (one
 * small query) after the first launch since. Plays of songs deleted before
 * the update keep none.
 */
export const keyRecordings = (db: LibraryDatabase): void => {
  const { tracks, albums, playEvents } = schema;
  const unkeyed = db
    .select({
      id: tracks.id,
      title: tracks.title,
      album: albums.title,
      albumArtist: albums.albumArtistCredit,
      discNumber: tracks.discNumber,
      trackNumber: tracks.trackNumber,
    })
    .from(tracks)
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .where(isNull(tracks.recordingKey))
    .all();
  if (unkeyed.length === 0) return;
  db.transaction((tx) => {
    for (const track of unkeyed) {
      tx.update(tracks)
        .set({ recordingKey: recordingKey(track) })
        .where(eq(tracks.id, track.id))
        .run();
    }
    for (let i = 0; i < unkeyed.length; i += CHUNK) {
      const ids = unkeyed.slice(i, i + CHUNK).map((track) => track.id);
      tx.update(playEvents)
        .set({ recordingKey: playRecordingKey(playEvents.trackId) })
        .where(and(isNull(playEvents.recordingKey), inArray(playEvents.trackId, ids)))
        .run();
    }
  });
};

/** The recording key of the Track [trackId] names, as SQL: what a play records. */
export const playRecordingKey = (trackId: unknown) =>
  sql<
    string | null
  >`(SELECT ${schema.tracks.recordingKey} FROM ${schema.tracks} WHERE ${schema.tracks.id} = ${trackId})`;

/** What tells a Track apart for the Wave account, by id. */
export interface TrackIdentity {
  readonly id: number;
  /** The file; null for a missing song. */
  readonly path: string | null;
  readonly recordingKey: string | null;
  /** The YouTube video id of a song downloaded from YouTube Music. */
  readonly videoId: string | null;
  readonly durationMs: number;
}

/** Every Track's identity for the Wave account (`TrackIdentity`), by id. */
export const selectTrackIdentities = (db: LibraryDatabase): TrackIdentity[] => {
  const { tracks } = schema;
  return db
    .select({
      id: tracks.id,
      path: tracks.path,
      recordingKey: tracks.recordingKey,
      videoId: tracks.videoId,
      durationMs: tracks.durationMs,
    })
    .from(tracks)
    .orderBy(asc(tracks.id))
    .all();
};

/** A change stamp as rows carry it (Core's `SyncRow` without its id). */
interface Stamp {
  readonly changedAt: number;
  readonly phoneId: string;
  readonly deleted: boolean;
}

/** A playlist as it last changed. */
export interface PlaylistChange extends Stamp {
  readonly syncId: string;
  /** The playlist on this phone. */
  readonly id: number;
  readonly name: string;
}

/** A playlist entry as it last changed. */
export interface PlaylistEntryChange extends Stamp {
  readonly syncId: string;
  /** The entry on this phone (`PlaylistEntry.itemId`). */
  readonly itemId: number;
  readonly playlistSyncId: string;
  readonly orderKey: string;
  /** The Library Track it holds, else null (a YT Music entry). */
  readonly trackId: number | null;
  /** That Track's recording key. */
  readonly recordingKey: string | null;
  /** A YT Music entry's song as stored (Core's `writePlaylistYtSong`). */
  readonly ytSong: string | null;
  readonly addedAt: number;
}

/** A star as it last changed. */
export interface FavoriteChange extends Stamp {
  readonly trackId: number;
  /** The starred Track's recording key: the star's id for the account. */
  readonly recordingKey: string | null;
  readonly addedAt: number;
}

/** A synced preference's last change. */
export interface PreferenceChange {
  /** Its key-value store key. */
  readonly key: string;
  readonly changedAt: number;
  readonly phoneId: string;
}

/** The rows that changed after a time, tombstones included, each kind oldest change first. */
export interface LibraryChanges {
  readonly playlists: readonly PlaylistChange[];
  readonly entries: readonly PlaylistEntryChange[];
  readonly favorites: readonly FavoriteChange[];
  readonly preferences: readonly PreferenceChange[];
}

/**
 * Every playlist, entry, star and synced preference changed after [since]
 * (ms since the epoch, exclusive; 0 for all), tombstones included, by
 * whichever phone changed it, each kind oldest change first.
 */
export const selectChangesSince = (db: LibraryDatabase, since: number): LibraryChanges => {
  const { playlists, playlistItems, favorites, tracks, preferenceChanges } = schema;
  return {
    playlists: db
      .select({
        syncId: playlists.syncId,
        id: playlists.id,
        name: playlists.name,
        changedAt: playlists.changedAt,
        phoneId: playlists.phoneId,
        deleted: playlists.deleted,
      })
      .from(playlists)
      .where(gt(playlists.changedAt, since))
      .orderBy(asc(playlists.changedAt), asc(playlists.id))
      .all(),
    entries: db
      .select({
        syncId: playlistItems.syncId,
        itemId: playlistItems.id,
        playlistSyncId: playlists.syncId,
        orderKey: playlistItems.orderKey,
        trackId: playlistItems.trackId,
        recordingKey: tracks.recordingKey,
        ytSong: playlistItems.ytSong,
        addedAt: playlistItems.addedAt,
        changedAt: playlistItems.changedAt,
        phoneId: playlistItems.phoneId,
        deleted: playlistItems.deleted,
      })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
      .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
      .where(gt(playlistItems.changedAt, since))
      .orderBy(asc(playlistItems.changedAt), asc(playlistItems.id))
      .all(),
    favorites: db
      .select({
        trackId: favorites.trackId,
        recordingKey: tracks.recordingKey,
        addedAt: favorites.addedAt,
        changedAt: favorites.changedAt,
        phoneId: favorites.phoneId,
        deleted: favorites.deleted,
      })
      .from(favorites)
      .innerJoin(tracks, eq(favorites.trackId, tracks.id))
      .where(gt(favorites.changedAt, since))
      .orderBy(asc(favorites.changedAt), asc(favorites.trackId))
      .all(),
    preferences: db
      .select({
        key: preferenceChanges.key,
        changedAt: preferenceChanges.changedAt,
        phoneId: preferenceChanges.phoneId,
      })
      .from(preferenceChanges)
      .where(gt(preferenceChanges.changedAt, since))
      .orderBy(asc(preferenceChanges.changedAt), asc(preferenceChanges.key))
      .all(),
  };
};
