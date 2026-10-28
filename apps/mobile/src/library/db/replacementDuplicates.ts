/**
 * The songs an interrupted quality replacement left twice (docs/spec.md, "YT
 * Music" › Download quality › Left twice): the files Core's
 * `replacementDuplicates` pairs, and putting a pair back to one song. Kept
 * free of Expo for the store tests.
 */
import type { DuplicateCheckFile, DuplicateMerge } from "@wave/core";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import { readCredits, type CreditSplits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { recordFileDeletions } from "./fileDeletions.ts";
import { pruneOrphans } from "./save.ts";
import * as schema from "./schema.ts";
import { stamped } from "./sync.ts";
import { leaveKeys } from "./syncRows.ts";
import { deleteTracksById } from "./tracks.ts";

/** Whether a Track is starred. */
const starred = sql<number>`EXISTS (SELECT 1 FROM favorites
  WHERE favorites.track_id = tracks.id AND favorites.deleted = 0)`;

/** How many plays a Track has. */
const playCount = sql<number>`(SELECT count(*) FROM play_events WHERE play_events.track_id = tracks.id)`;

/** The playlists holding an entry of a Track, as `1,4,9` (null for none). */
const playlistIds = sql<string | null>`(SELECT group_concat(id) FROM (
  SELECT DISTINCT playlist_items.playlist_id AS id FROM playlist_items
  WHERE playlist_items.track_id = tracks.id AND playlist_items.deleted = 0
  ORDER BY playlist_items.playlist_id))`;

/** [ids] in order; a fresh array, sorted in place (Hermes lacks `toSorted`). */
const sortedIds = (ids: readonly number[]): number[] =>
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  [...ids].sort((a, b) => a - b);

const readIds = (ids: string | null): number[] =>
  ids === null ? [] : sortedIds(ids.split(",").map(Number));

/**
 * The Library's MP3 and M4A files (the only kinds a replacement makes), with
 * their recordings and their Track's star, plays and playlists: what the check pairs.
 */
export const selectDuplicateCheckFiles = (db: LibraryDatabase): DuplicateCheckFile[] => {
  const t = schema.tracks;
  return db
    .select({
      id: t.id,
      path: t.path,
      recordingKey: t.recordingKey,
      title: t.title,
      artist: t.artistCredit,
      artists: t.artistCredits,
      durationMs: t.durationMs,
      favorite: starred,
      plays: playCount,
      playlists: playlistIds,
    })
    .from(t)
    .where(
      and(
        isNotNull(t.path),
        or(sql`lower(${t.path}) LIKE '%.mp3'`, sql`lower(${t.path}) LIKE '%.m4a'`),
      ),
    )
    .orderBy(t.id)
    .all()
    .flatMap(({ path, artist, artists, favorite, playlists, ...song }) =>
      path === null
        ? []
        : [
            {
              ...song,
              path,
              artists: readCredits(artist, artists),
              favorite: Boolean(favorite),
              playlists: readIds(playlists),
            },
          ],
    );
};

/** A Track as the check read it: its file, star and playlists. */
interface CheckedTrack {
  readonly id: number;
  readonly path: string;
  readonly favorite: boolean;
  readonly playlists: readonly number[];
}

/** A pair's fix as Core decided it (`replacementDuplicateFix`), as the store applies it. */
export interface DuplicateFixToApply {
  /** Keeps its favorites, plays and playlist entries. */
  readonly keep: CheckedTrack;
  /** The Track that goes. */
  readonly drop: CheckedTrack;
  /** The file [keep] ends on: its own, or [drop]'s. */
  readonly path: string;
  /** The file that goes. */
  readonly deleted: string;
  /** What [drop] hands to [keep]; null when it has nothing. */
  readonly merge: DuplicateMerge | null;
}

/**
 * Puts a pair back to one song, in one transaction: [drop] hands [keep] its
 * history as Core planned it ([fix] `merge`: the star, the plays, its playlist
 * entries moved to [keep] or, in a playlist already holding [keep], removed);
 * then it goes (and, signed in, a recording no Track keeps leaves the account:
 * `leaveKeys`); the kept Track takes [drop]'s file when [fix] says so (its file
 * columns: where it is, its size, length, bitrate and lyrics flag; its tags
 * stay); and the other file's deletion is recorded (`recordFileDeletions`), for
 * the app's `finishFileDeletions`. False, changing nothing, when either Track
 * is gone, on another file, or starred or in playlists other than the check
 * read them.
 */
export const fixReplacementDuplicate = (
  db: LibraryDatabase,
  splits: CreditSplits,
  fix: DuplicateFixToApply,
  now: number,
): boolean => {
  const t = schema.tracks;
  return db.transaction((tx) => {
    const fileOf = (track: CheckedTrack) =>
      tx
        .select({
          recordingKey: t.recordingKey,
          folderId: t.folderId,
          fileName: t.fileName,
          sizeBytes: t.sizeBytes,
          modifiedAt: t.modifiedAt,
          durationMs: t.durationMs,
          sampleRate: t.sampleRate,
          bitrateKbps: t.bitrateKbps,
          hasLyrics: t.hasLyrics,
          videoId: t.videoId,
          scannedAt: t.scannedAt,
          favorite: starred,
          playlists: playlistIds,
        })
        .from(t)
        .where(and(eq(t.id, track.id), eq(t.path, track.path)))
        .get();
    const asChecked = (
      found: ReturnType<typeof fileOf>,
      track: CheckedTrack,
    ): found is NonNullable<typeof found> =>
      found !== undefined &&
      Boolean(found.favorite) === track.favorite &&
      readIds(found.playlists).join() === sortedIds(track.playlists).join();
    const kept = fileOf(fix.keep);
    const dropped = fileOf(fix.drop);
    if (!asChecked(kept, fix.keep) || !asChecked(dropped, fix.drop)) return false;
    if (fix.merge !== null) mergeHistory(tx, fix.keep.id, fix.drop.id, fix.merge, now);
    const { recordingKey, favorite: _favorite, playlists: _playlists, ...file } = dropped;
    if (recordingKey !== null)
      leaveKeys(tx, [{ trackId: fix.drop.id, recordingKey }], { removed: true, now });
    deleteTracksById(tx, [fix.drop.id]);
    if (fix.path === fix.drop.path)
      tx.update(t)
        .set({ ...file, path: fix.drop.path })
        .where(eq(t.id, fix.keep.id))
        .run();
    recordFileDeletions(tx, [fix.deleted], now);
    pruneOrphans(tx, splits);
    return true;
  });
};

/**
 * Track [from] hands Track [to] its history ([merge]). Its entries keep their
 * ids on every phone: moved ones name [to] from now on, removed ones go as
 * tombstones naming [to], so they outlive [from] and the account drops them too.
 */
const mergeHistory = (
  tx: LibraryDatabase,
  to: number,
  from: number,
  merge: DuplicateMerge,
  now: number,
): void => {
  const { favorites, playEvents, playlistItems } = schema;
  if (merge.star) {
    const addedAt =
      tx
        .select({ addedAt: favorites.addedAt })
        .from(favorites)
        .where(eq(favorites.trackId, from))
        .get()?.addedAt ?? now;
    tx.insert(favorites)
      .values({ trackId: to, addedAt, changedAt: now })
      .onConflictDoUpdate({
        target: favorites.trackId,
        set: { addedAt, deleted: false, ...stamped(favorites, now) },
      })
      .run();
  }
  if (merge.movePlays)
    tx.update(playEvents).set({ trackId: to }).where(eq(playEvents.trackId, from)).run();
  const entriesIn = (playlists: readonly number[]) =>
    and(
      eq(playlistItems.trackId, from),
      eq(playlistItems.deleted, false),
      inArray(playlistItems.playlistId, [...playlists]),
    );
  if (merge.repoint.length > 0)
    tx.update(playlistItems)
      .set({ trackId: to, ...stamped(playlistItems, now) })
      .where(entriesIn(merge.repoint))
      .run();
  if (merge.remove.length > 0)
    tx.update(playlistItems)
      .set({ trackId: to, deleted: true, ...stamped(playlistItems, now) })
      .where(entriesIn(merge.remove))
      .run();
};
