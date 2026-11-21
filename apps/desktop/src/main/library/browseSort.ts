import type { LibraryDatabase } from "@wave/client/db/database";
import { stampPreference } from "@wave/client/db/sync";
import {
  CUSTOM_SONG_SORT,
  PLAYLIST_SONG_SORT_BUCKETS,
  PLAYLIST_SONG_SORTS,
  readPlaylistSongSort,
  readPlaylistSongSorts,
  storedPlaylistSongSort,
  storedSyncedBucket,
  syncedBucket,
  withSyncedBucketEntry,
  type PlaylistSongSort,
  libraryTableSortsFor,
  nextHeaderSort,
  readLibraryTableSort,
  songBrowseOrderTerms,
  songSpineField,
  writeSongSort,
  type SongOrderField,
  type SongSort,
} from "@wave/core";
import { asc, desc, sql, type SQL } from "drizzle-orm";
import { preference, savePreference } from "../preferences.ts";
import { keepPreference, syncedPreference } from "../sync/desktopSync.ts";

const preferenceKey = (kind: string) => `tableSort.${kind}`;

export const readBrowseSort = (db: LibraryDatabase, kind: string): SongSort | undefined => {
  const choices = libraryTableSortsFor(kind);
  return choices.length === 0
    ? undefined
    : readLibraryTableSort(choices, preference(db, preferenceKey(kind)) ?? null);
};

export const toggleBrowseSort = (db: LibraryDatabase, kind: string, key: string): void => {
  const choices = libraryTableSortsFor(kind);
  const current = readLibraryTableSort(choices, preference(db, preferenceKey(kind)) ?? null);
  const next = current && nextHeaderSort(choices, current, key);
  if (next) savePreference(db, preferenceKey(kind), writeSongSort(next));
};

/** The synced preference holding the sort of the playlist with sync id [syncId], as the phone's. */
const playlistSortsKey = (syncId: string) =>
  `settings.playlistSongs.${syncedBucket(syncId, PLAYLIST_SONG_SORT_BUCKETS)}`;

const playlistSyncId = (db: LibraryDatabase, playlistId: number): string | undefined =>
  db.get<{ syncId: string }>(sql`SELECT sync_id AS syncId FROM playlists WHERE id=${playlistId}`)
    ?.syncId;

/** The sort the playlist's page shows in: its own, kept on the Wave account; Custom until chosen. */
export const playlistSongSort = (db: LibraryDatabase, playlistId: number): PlaylistSongSort => {
  const syncId = playlistSyncId(db, playlistId);
  return syncId === undefined
    ? CUSTOM_SONG_SORT
    : readPlaylistSongSort(
        readPlaylistSongSorts(syncedPreference(db, playlistSortsKey(syncId)))[syncId],
      );
};

/**
 * A click on the playlist's [key] header: starts that sort or reverses it, and Custom's goes back
 * to the playlist's own order. False when the header isn't one, or the account can't keep it.
 */
export const togglePlaylistSort = (
  db: LibraryDatabase,
  playlistId: number,
  key: string,
): boolean => {
  const syncId = playlistSyncId(db, playlistId);
  if (syncId === undefined || !PLAYLIST_SONG_SORTS.some((sort) => sort.key === key)) return false;
  const next = nextHeaderSort(PLAYLIST_SONG_SORTS, playlistSongSort(db, playlistId), key);
  if (next === undefined) return true;
  const bucket = playlistSortsKey(syncId);
  const entries = withSyncedBucketEntry(
    readPlaylistSongSorts(syncedPreference(db, bucket)),
    syncId,
    storedPlaylistSongSort(next),
  );
  if (entries === null) return false;
  keepPreference(db, bucket, storedSyncedBucket(entries));
  stampPreference(db, bucket, Date.now());
  return true;
};

/** Fields projected by the songs query in browse.ts. */
const columns: Record<SongOrderField | "starredAt", SQL> = {
  titleSort: sql`sort`,
  artistSort: sql`artistSort`,
  albumSort: sql`albumSort`,
  albumId: sql`albumId`,
  discNumber: sql`disc`,
  trackNumber: sql`trackNumber`,
  addedAt: sql`addedAt`,
  starredAt: sql`starredAt`,
  path: sql`path`,
  id: sql`id`,
};

/** Core's primary and tie orders, applied before paging or starting playback. */
export const songBrowseOrder = (sort: SongSort): SQL => {
  const order = songBrowseOrderTerms(sort).map(({ field, descending, nullAs }) => {
    const column = columns[field];
    const value = nullAs === undefined ? column : sql`coalesce(${column}, ${nullAs})`;
    return descending ? desc(value) : asc(value);
  });
  return sql.join(order, sql`, `);
};

export const songBrowseSpine = (sort: SongSort): SQL | undefined => {
  const field = songSpineField(sort);
  return field === undefined ? undefined : columns[field];
};
