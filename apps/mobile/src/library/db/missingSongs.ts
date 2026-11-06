/**
 * Missing songs (docs/spec.md, "Wave account and sync" › Missing songs):
 * Tracks the Wave account has and this phone has no file for (`path` null).
 * They come in from the account's songs, stay when a scan no longer finds a
 * file while signed in, leave the Library and the account together (Remove
 * from Library, Delete), and go when the phone signs out. Kept free of Expo
 * so the store tests run it against a real SQLite (`testDatabase.ts`).
 */
import {
  compareAlbumTracks,
  leavingSongEntry,
  missingSongYtSong,
  planMissingSongs,
  signOutPlan,
  vanishedFile,
  writePlaylistEntrySong,
  writePlaylistYtSong,
  type MissingTrack,
  type SyncSongFields,
} from "@wave/core";
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import { readCredits, type CreditSplits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { leavingSong, leavingSongColumns } from "./leavingSong.ts";
import { pruneOrphans, saveMissingSongs } from "./save.ts";
import * as schema from "./schema.ts";
import { stamped } from "./sync.ts";
import { leaveAccount, leaveKeys, selectJoinedAccount } from "./syncRows.ts";
import { deleteTracks, deleteTracksById } from "./tracks.ts";

/**
 * Brings the Library's missing songs in line with the account's songs (the
 * phone's last pull), as Core's `planMissingSongs` decides: account songs no
 * Track has come in, missing songs take tags changed on another phone, and
 * those the account no longer has leave. True when the Library changed.
 */
export const syncMissingSongs = (
  db: LibraryDatabase,
  splits: CreditSplits,
  now: number,
): boolean => {
  const { accountSongs, tracks, albums, genres } = schema;
  const account = db
    .select({ recordingKey: accountSongs.recordingKey, song: accountSongs.song })
    .from(accountSongs)
    .where(and(eq(accountSongs.deleted, false), isNotNull(accountSongs.song)))
    .all()
    .flatMap(({ recordingKey, song }) =>
      song === null ? [] : [{ recordingKey, song: JSON.parse(song) as SyncSongFields }],
    );
  const held = db
    .selectDistinct({ key: tracks.recordingKey })
    .from(tracks)
    .where(isNotNull(tracks.recordingKey))
    .all()
    .flatMap((row) => row.key ?? []);
  const missing = db
    .select({
      id: tracks.id,
      recordingKey: tracks.recordingKey,
      title: tracks.title,
      artist: tracks.artistCredit,
      album: albums.title,
      albumArtist: albums.albumArtistCredit,
      genre: genres.name,
      releaseDate: tracks.releaseDate,
      year: tracks.year,
      trackNumber: tracks.trackNumber,
      discNumber: tracks.discNumber,
      durationMs: tracks.durationMs,
      videoId: tracks.videoId,
    })
    .from(tracks)
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(genres, eq(tracks.genreId, genres.id))
    .where(isNull(tracks.path))
    .all();
  const plan = planMissingSongs({ account, held, missing });
  if (plan.save.length === 0 && plan.leave.length === 0) return false;
  db.transaction((tx) => {
    saveMissingSongs(tx, splits, plan.save, now);
    deleteTracksById(tx, plan.leave);
    if (plan.prune) pruneOrphans(tx, splits);
  });
  return true;
};

/**
 * The missing songs, as downloading them takes them (Core's `MissingTrack`):
 * each Track's tags, in title order. With [ids], only those Tracks', when
 * they're still missing.
 */
export const selectMissingSongs = (
  db: LibraryDatabase,
  ids?: readonly number[],
): MissingTrack[] => {
  const { tracks, albums, genres } = schema;
  const read = (where: SQL | undefined) =>
    db
      .select({
        id: tracks.id,
        title: tracks.title,
        artist: tracks.artistCredit,
        artists: tracks.artistCredits,
        album: albums.title,
        albumArtist: albums.albumArtistCredit,
        year: tracks.year,
        trackNumber: tracks.trackNumber,
        discNumber: tracks.discNumber,
        genre: genres.name,
        durationMs: tracks.durationMs,
        videoId: tracks.videoId,
        releaseDate: tracks.releaseDate,
        titleSort: tracks.titleSort,
      })
      .from(tracks)
      .innerJoin(albums, eq(tracks.albumId, albums.id))
      .leftJoin(genres, eq(tracks.genreId, genres.id))
      .where(where)
      .all();
  const rows =
    ids === undefined
      ? read(isNull(tracks.path))
      : chunks(ids).flatMap((some) => read(and(isNull(tracks.path), inArray(tracks.id, some))));
  return rows
    .sort((a, b) => (a.titleSort < b.titleSort ? -1 : a.titleSort > b.titleSort ? 1 : a.id - b.id))
    .map((row) => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      artists: readCredits(row.artist, row.artists),
      album: row.album,
      albumArtist: row.albumArtist,
      year: row.year,
      trackNumber: row.trackNumber,
      discNumber: row.discNumber,
      genre: row.genre ?? null,
      durationMs: row.durationMs,
      videoId: row.videoId,
      releaseDate: row.releaseDate,
    }));
};

/**
 * The missing songs of each album of [albumIds], as their Track ids in album
 * order (Core's `compareAlbumTracks`): what an album's Download Missing Songs
 * asks for. An album with every file has none.
 */
export const selectAlbumsMissingSongs = (
  db: LibraryDatabase,
  albumIds: readonly number[],
): number[][] => {
  const { tracks } = schema;
  const rows = chunks(albumIds).flatMap((some) =>
    db
      .select({
        id: tracks.id,
        albumId: tracks.albumId,
        discNumber: tracks.discNumber,
        trackNumber: tracks.trackNumber,
        titleSort: tracks.titleSort,
        path: tracks.path,
      })
      .from(tracks)
      .where(and(isNull(tracks.path), inArray(tracks.albumId, some)))
      .all(),
  );
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  rows.sort(compareAlbumTracks);
  return albumIds.map((albumId) =>
    rows.flatMap((row) => (row.albumId === albumId ? [row.id] : [])),
  );
};

/**
 * What a scan does with the files at [paths] it no longer found, once it
 * completes (Core's `vanishedFile`): signed in to a Wave account, their songs
 * stay as missing songs, with their favorites, playlist entries and plays,
 * so an unmounted or emptied folder can't take them out of the account;
 * signed out, they leave the Library, their playlist entries kept as songs
 * without a file, stamped at [now] (`keepPlaylistEntries`). Either way the
 * albums, artists and genres the scan's changes left empty go (`pruneOrphans`).
 */
export const filesGone = (
  db: LibraryDatabase,
  splits: CreditSplits,
  paths: readonly string[],
  now: number,
): void => {
  db.transaction((tx) => {
    leaveFiles(tx, paths, now);
    pruneOrphans(tx, splits);
  });
};

/**
 * The files at [paths] leave the Library (a scan no longer finds them, or
 * their music folder was removed): signed in, their songs stay as missing
 * songs; signed out, they go (Core's `vanishedFile`), their playlist entries
 * kept as songs without a file, stamped at [now] (`keepPlaylistEntries`). Run
 * it in the transaction that prunes what they leave empty.
 */
export const leaveFiles = (tx: LibraryDatabase, paths: readonly string[], now: number): void => {
  const signedIn = selectJoinedAccount(tx) !== null;
  const { tracks } = schema;
  if (vanishedFile({ signedIn }) === "remove") {
    for (const some of chunks(paths)) {
      const ids = tx
        .select({ id: tracks.id })
        .from(tracks)
        .where(inArray(tracks.path, some))
        .all()
        .map((row) => row.id);
      keepPlaylistEntries(tx, ids, now);
    }
    deleteTracks(tx, paths);
    return;
  }
  for (const chunk of chunks(paths)) {
    tx.update(tracks).set({ path: null }).where(inArray(tracks.path, chunk)).run();
  }
};

/**
 * Keeps the playlist entries of the Tracks [trackIds], about to leave the
 * Library, in their place: each becomes the entry a song without a file is
 * (Core's `leavingSongEntry`: a YT Music entry of the video a song was
 * downloaded from, else an unsearched entry), removed ones and the
 * Graveyard's too, each stamped at [now] so the Wave account carries it to
 * the other phones. Run it in the transaction that removes the Tracks,
 * before they go.
 */
const keepPlaylistEntries = (
  tx: LibraryDatabase,
  trackIds: readonly number[],
  now: number,
): void => {
  const { tracks, albums, playlistItems } = schema;
  for (const ids of chunks(trackIds)) {
    const songs = tx
      .select({ id: tracks.id, ...leavingSongColumns })
      .from(tracks)
      .innerJoin(albums, eq(tracks.albumId, albums.id))
      .where(
        and(
          inArray(tracks.id, ids),
          inArray(tracks.id, tx.select({ id: playlistItems.trackId }).from(playlistItems)),
        ),
      )
      .all();
    for (const song of songs) {
      const entry = leavingSongEntry(leavingSong(song));
      tx.update(playlistItems)
        .set({
          trackId: null,
          ytSong: writePlaylistEntrySong(entry),
          ...stamped(playlistItems, now),
        })
        .where(eq(playlistItems.trackId, song.id))
        .run();
    }
  }
};

/**
 * Takes songs out of the Library and, signed in, out of the Wave account:
 * Remove from Library on missing songs, and Delete once their files are
 * gone. Their playlist entries stay, as songs without a file
 * (`keepPlaylistEntries`); their favorites go; their plays stay. Each song
 * whose recording key no other Track has leaves the account with its star,
 * as removals (tombstones) the next push sends (`leaveKeys`): other phones
 * lose them at their next pull, and the song too where it's a missing song
 * (`syncMissingSongs`).
 */
export const removeSongs = (
  db: LibraryDatabase,
  splits: CreditSplits,
  trackIds: readonly number[],
  now: number,
): void => {
  if (trackIds.length === 0) return;
  db.transaction((tx) => removeTracks(tx, splits, trackIds, now, "stay"));
};

/**
 * `removeSongs` inside a transaction of the caller's, with what becomes of
 * the songs' playlist [entries]: they "stay" (`removeSongs`), or "leave" with
 * the songs, as a voice note a scan skips takes its entries along.
 */
export const removeTracks = (
  tx: LibraryDatabase,
  splits: CreditSplits,
  trackIds: readonly number[],
  now: number,
  entries: "stay" | "leave",
): void => {
  if (trackIds.length === 0) return;
  if (entries === "stay") keepPlaylistEntries(tx, trackIds, now);
  const { tracks } = schema;
  const leaving = chunks(trackIds).flatMap((ids) =>
    tx
      .select({ trackId: tracks.id, recordingKey: sql<string>`${tracks.recordingKey}` })
      .from(tracks)
      .where(and(inArray(tracks.id, ids), isNotNull(tracks.recordingKey)))
      .all(),
  );
  leaveKeys(tx, leaving, { removed: true, now });
  deleteTracksById(tx, trackIds);
  pruneOrphans(tx, splits);
};

/**
 * Signing out of the Wave account (Core's `signOutPlan`): the Library leaves
 * the account (the next sign-in joins anew), and its missing songs go, since
 * the phone has nothing of them. A playlist entry of one downloaded from
 * YouTube Music becomes a YT Music entry of its video; any other leaves its
 * playlist, as a deleted file's does. Everything else stays.
 */
export const signOut = (db: LibraryDatabase, splits: CreditSplits): void => {
  leaveAccount(db);
  const { playlistItems } = schema;
  const missing = selectMissingSongs(db);
  if (missing.length === 0) return;
  const entries = chunks(missing.map((song) => song.id)).flatMap((ids) =>
    db
      .select({ id: playlistItems.id, trackId: sql<number>`${playlistItems.trackId}` })
      .from(playlistItems)
      .where(inArray(playlistItems.trackId, ids))
      .all(),
  );
  const plan = signOutPlan({ missing, entries });
  db.transaction((tx) => {
    for (const { entry } of plan.toYtMusic) {
      const song = missing.find((each) => each.id === entry.trackId);
      const ytSong = song === undefined ? null : missingSongYtSong(song);
      if (ytSong === null) continue;
      // A change on this phone alone: it isn't stamped, so it goes nowhere.
      tx.update(playlistItems)
        .set({ trackId: null, ytSong: writePlaylistYtSong(ytSong) })
        .where(eq(playlistItems.id, entry.id))
        .run();
    }
    // The entries that leave go with their songs, as a deleted file's do.
    deleteTracksById(
      tx,
      plan.remove.map((song) => song.id),
    );
    pruneOrphans(tx, splits);
  });
};
