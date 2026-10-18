/**
 * The songs an interrupted quality replacement left twice (docs/spec.md, "YT
 * Music" › Download quality › Left twice): the files Core's
 * `replacementDuplicates` pairs, and putting a pair back to one song. Kept
 * free of Expo for the store tests.
 */
import type { DuplicateCheckFile } from "@wave/core";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";

import type { CreditSplits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { recordFileDeletions } from "./fileDeletions.ts";
import { pruneOrphans } from "./save.ts";
import * as schema from "./schema.ts";
import { leaveKeys } from "./syncRows.ts";
import { deleteTracksById } from "./tracks.ts";

/** Whether a Track has favorites, plays or playlist entries. */
const hasHistory = sql<number>`(
  EXISTS (SELECT 1 FROM favorites WHERE favorites.track_id = tracks.id AND favorites.deleted = 0)
  OR EXISTS (SELECT 1 FROM playlist_items
    WHERE playlist_items.track_id = tracks.id AND playlist_items.deleted = 0)
  OR EXISTS (SELECT 1 FROM play_events WHERE play_events.track_id = tracks.id))`;

/**
 * The Library's MP3 and M4A files (the only kinds a replacement makes), with
 * their recordings and whether their Track has history: what the check pairs.
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
      history: hasHistory,
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
    .flatMap(({ path, artist, artists, history, ...song }) =>
      path === null
        ? []
        : [
            {
              ...song,
              path,
              artists: artists === null ? [artist] : (JSON.parse(artists) as string[]),
              history: Boolean(history),
            },
          ],
    );
};

/** A Track and the file the check found it on. */
interface CheckedTrack {
  readonly id: number;
  readonly path: string;
}

/** A pair's fix as Core decided it (`replacementDuplicateFix`), as the store applies it. */
export interface DuplicateFixToApply {
  /** Keeps its favorites, plays and playlist entries. */
  readonly keep: CheckedTrack;
  /** The bare Track, which goes. */
  readonly drop: CheckedTrack;
  /** The file [keep] ends on: its own, or [drop]'s. */
  readonly path: string;
  /** The file that goes. */
  readonly deleted: string;
}

/**
 * Puts a pair back to one song, in one transaction: the bare Track goes (and,
 * signed in, a recording no Track keeps leaves the account: `leaveKeys`); the
 * kept Track takes the bare one's file when [fix] says so (its file columns:
 * where it is, its size, length, bitrate and lyrics flag; its tags stay); and
 * the other file's deletion is recorded (`recordFileDeletions`), for the app's
 * `finishFileDeletions`. False, changing nothing, when either Track is gone or
 * on another file since the check read them.
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
        })
        .from(t)
        .where(and(eq(t.id, track.id), eq(t.path, track.path)))
        .get();
    const kept = fileOf(fix.keep);
    const dropped = fileOf(fix.drop);
    if (kept === undefined || dropped === undefined) return false;
    const { recordingKey, ...file } = dropped;
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
