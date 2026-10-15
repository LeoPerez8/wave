/**
 * Missing songs (docs/spec.md, "Wave account and sync" › Missing songs):
 * Tracks the Wave account has and this phone has no file for (`path` null).
 * They come in from the account's songs, stay when a scan no longer finds a
 * file while signed in, leave the Library and the account together (Remove
 * from Library, Delete), and go when the phone signs out. Kept free of Expo
 * so the store tests run it against a real SQLite (`testDatabase.ts`).
 */
import {
  UNKNOWN_ALBUM,
  missingSongTrack,
  signOutPlan,
  vanishedFile,
  writePlaylistYtSong,
  type MissingSongTrack,
  type MissingTrack,
  type SyncSongFields,
} from "@wave/core";
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import type { CreditSplits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { pruneOrphans, saveMissingSongs, type MissingSongSave } from "./save.ts";
import * as schema from "./schema.ts";
import { thisPhoneId } from "./schema.ts";
import { leaveAccount, selectJoinedAccount } from "./syncRows.ts";
import { deleteTracks, deleteTracksById } from "./tracks.ts";

/** Ids per statement, well under SQLite's limit on bound values. */
const CHUNK = 500;

const chunks = <A>(items: readonly A[]): A[][] => {
  const out: A[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

/** What a missing Track shows of its account song, to tell when the account's tags changed. */
const shownTags = (track: {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly albumArtist: string;
  readonly genre: string | null;
  readonly year: number | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly durationMs: number;
  readonly videoId: string | null;
}): string =>
  JSON.stringify([
    track.title,
    track.artist,
    track.album,
    track.albumArtist,
    track.genre,
    track.year,
    track.trackNumber,
    track.discNumber,
    track.durationMs,
    track.videoId,
  ]);

const tagsOf = (track: MissingSongTrack, videoId: string | null) =>
  shownTags({ ...track, videoId });

/**
 * Brings the Library's missing songs in line with the account's songs (the
 * phone's last pull): an account song no Track has comes in as a missing
 * song, a missing song takes the account's tags when they changed on another
 * phone, and one the account no longer has (removed there, or never sent up)
 * leaves. Tracks with a file are never touched. True when the Library changed.
 */
export const syncMissingSongs = (
  db: LibraryDatabase,
  splits: CreditSplits,
  now: number,
): boolean => {
  const { accountSongs, tracks, albums, genres } = schema;
  const live = new Map(
    db
      .select({ recordingKey: accountSongs.recordingKey, song: accountSongs.song })
      .from(accountSongs)
      .where(and(eq(accountSongs.deleted, false), isNotNull(accountSongs.song)))
      .all()
      .flatMap((row) =>
        row.song === null
          ? []
          : [[row.recordingKey, JSON.parse(row.song) as SyncSongFields] as const],
      ),
  );
  const held = new Set(
    db
      .selectDistinct({ key: tracks.recordingKey })
      .from(tracks)
      .where(isNotNull(tracks.recordingKey))
      .all()
      .flatMap((row) => row.key ?? []),
  );
  const missing = db
    .select({
      id: tracks.id,
      recordingKey: tracks.recordingKey,
      title: tracks.title,
      artist: tracks.artistCredit,
      album: albums.title,
      albumArtist: albums.albumArtistCredit,
      genre: genres.name,
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

  const save: MissingSongSave[] = [];
  const leaving: number[] = [];
  for (const track of missing) {
    const song = track.recordingKey === null ? undefined : live.get(track.recordingKey);
    if (song === undefined || track.recordingKey === null) {
      leaving.push(track.id);
      continue;
    }
    const tags = missingSongTrack(song);
    if (shownTags(track) !== tagsOf(tags, song.videoId)) {
      save.push({
        trackId: track.id,
        recordingKey: track.recordingKey,
        track: tags,
        videoId: song.videoId,
        addedAt: song.addedAt,
      });
    }
  }
  const retagged = save.length > 0;
  for (const [recordingKey, song] of live) {
    if (held.has(recordingKey)) continue;
    save.push({
      trackId: null,
      recordingKey,
      track: missingSongTrack(song),
      videoId: song.videoId,
      addedAt: song.addedAt,
    });
  }
  if (save.length === 0 && leaving.length === 0) return false;
  db.transaction((tx) => {
    saveMissingSongs(tx, splits, save, now);
    deleteTracksById(tx, leaving);
    // What left, or changed its tags, can leave albums, artists and genres empty.
    if (retagged || leaving.length > 0) pruneOrphans(tx, splits);
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
      artists: row.artists === null ? [row.artist] : (JSON.parse(row.artists) as string[]),
      album: row.album,
      albumArtist: row.albumArtist,
      year: row.year,
      trackNumber: row.trackNumber,
      discNumber: row.discNumber,
      genre: row.genre ?? null,
      durationMs: row.durationMs,
      videoId: row.videoId,
    }));
};

/**
 * What a scan does with the files at [paths] it no longer found, once it
 * completes (Core's `vanishedFile`): signed in to a Wave account, their songs
 * stay as missing songs, with their favorites, playlist entries and plays,
 * so an unmounted or emptied folder can't take them out of the account;
 * signed out, they leave the Library, as before. Either way the albums,
 * artists and genres the scan's changes left empty go (`pruneOrphans`).
 */
export const filesGone = (
  db: LibraryDatabase,
  splits: CreditSplits,
  paths: readonly string[],
): void => {
  db.transaction((tx) => {
    leaveFiles(tx, paths);
    pruneOrphans(tx, splits);
  });
};

/**
 * The files at [paths] leave the Library (a scan no longer finds them, or
 * their music folder was removed): signed in, their songs stay as missing
 * songs; signed out, they go (Core's `vanishedFile`). Run it in the
 * transaction that prunes what they leave empty.
 */
export const leaveFiles = (tx: LibraryDatabase, paths: readonly string[]): void => {
  const signedIn = selectJoinedAccount(tx) !== null;
  if (vanishedFile({ signedIn }) === "remove") {
    deleteTracks(tx, paths);
    return;
  }
  const { tracks } = schema;
  for (const chunk of chunks(paths)) {
    tx.update(tracks).set({ path: null }).where(inArray(tracks.path, chunk)).run();
  }
};

/**
 * Takes songs out of the Library and, signed in, out of the Wave account:
 * Remove from Library on missing songs, and Delete once their files are
 * gone. Their favorites and playlist entries go with them; their plays
 * stay. Each song whose recording key no other Track has leaves the account
 * as a removal (a tombstone) the next push sends, and other phones lose it
 * at their next pull (`syncMissingSongs`).
 */
export const removeSongs = (
  db: LibraryDatabase,
  splits: CreditSplits,
  trackIds: readonly number[],
  now: number,
): void => {
  if (trackIds.length === 0) return;
  const { tracks, accountSongs } = schema;
  db.transaction((tx) => {
    const keys = new Set(
      chunks(trackIds).flatMap((ids) =>
        tx
          .selectDistinct({ key: tracks.recordingKey })
          .from(tracks)
          .where(inArray(tracks.id, ids))
          .all()
          .flatMap((row) => row.key ?? []),
      ),
    );
    deleteTracksById(tx, trackIds);
    pruneOrphans(tx, splits);
    if (selectJoinedAccount(tx) === null) return;
    const stillHeld = new Set(
      chunks([...keys]).flatMap((some) =>
        tx
          .selectDistinct({ key: tracks.recordingKey })
          .from(tracks)
          .where(inArray(tracks.recordingKey, some))
          .all()
          .flatMap((row) => row.key ?? []),
      ),
    );
    for (const recordingKey of keys) {
      if (stillHeld.has(recordingKey)) continue;
      const removal = {
        song: null,
        deleted: true,
        phoneId: thisPhoneId(),
        pushed: false,
        local: null,
      };
      tx.insert(accountSongs)
        .values({ recordingKey, changedAt: now, ...removal })
        .onConflictDoUpdate({
          target: accountSongs.recordingKey,
          set: { ...removal, changedAt: sql`max(${now}, ${accountSongs.changedAt} + 1)` },
        })
        .run();
    }
  });
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
  const { tracks, albums, playlistItems } = schema;
  const missing = db
    .select({
      id: tracks.id,
      videoId: tracks.videoId,
      title: tracks.title,
      artist: tracks.artistCredit,
      artists: tracks.artistCredits,
      album: albums.title,
      durationMs: tracks.durationMs,
    })
    .from(tracks)
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .where(isNull(tracks.path))
    .all();
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
    for (const { entry, videoId } of plan.toYtMusic) {
      const song = missing.find((each) => each.id === entry.trackId);
      if (song === undefined) continue;
      // A change on this phone alone: it isn't stamped, so it goes nowhere.
      tx.update(playlistItems)
        .set({
          trackId: null,
          ytSong: writePlaylistYtSong({
            videoId,
            title: song.title,
            artists: song.artists === null ? [song.artist] : (JSON.parse(song.artists) as string[]),
            album: song.album === UNKNOWN_ALBUM ? null : song.album,
            durationMs: song.durationMs > 0 ? song.durationMs : null,
            artworkUrl: null,
            explicit: false,
          }),
        })
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
