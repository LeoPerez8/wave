/** Phone-local ReccoBeats feature cache for songs in the candidate catalog. */
import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type { DjAudioFeatures } from "@wave/core";

import type { LibraryDatabase } from "./database.ts";
import { candidateSongs, djMoodFeatures } from "./schema.ts";
import { readPlaylistYtSong } from "@wave/core";
import { chunks } from "./chunks.ts";

export const DJ_MOOD_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DJ_MOOD_PAGE_SIZE = 40;
/**
 * How long a song whose lookup failed (a service error, an answer that doesn't
 * read) waits before it is due again (#1437). Unsaved, it stayed due, and every
 * pass the catalog started read and asked about it again.
 */
export const DJ_MOOD_RETRY_MS = 6 * 60 * 60 * 1000;

export interface DjMoodLookupSong {
  readonly videoId: string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly durationMs: number | null;
}

/** One page of candidate songs due for a mood lookup. */
export interface DjMoodLookupPage {
  /** The songs whose stored entry reads, in video-id order. */
  readonly songs: DjMoodLookupSong[];
  /** Video ids whose stored entry no longer reads; the worker saves them as misses. */
  readonly unreadable: string[];
  /** The page's last video id, read or not, as the next page's cursor; null when it is empty. */
  readonly last: string | null;
}

/** Candidate songs with no answer, or an expired miss, in video-id order. */
export const pendingDjMoodSongs = (
  db: LibraryDatabase,
  after: string,
  now: number,
  limit = DJ_MOOD_PAGE_SIZE,
): DjMoodLookupPage => {
  const rows = db
    .select({ videoId: candidateSongs.videoId, song: candidateSongs.song })
    .from(candidateSongs)
    .leftJoin(djMoodFeatures, eq(djMoodFeatures.videoId, candidateSongs.videoId))
    .where(
      and(
        gt(candidateSongs.videoId, after),
        or(
          isNull(djMoodFeatures.videoId),
          and(
            isNull(djMoodFeatures.energy),
            lte(djMoodFeatures.checkedAt, now - DJ_MOOD_MISS_TTL_MS),
          ),
        ),
      ),
    )
    .orderBy(asc(candidateSongs.videoId))
    .limit(limit)
    .all();
  const songs: DjMoodLookupSong[] = [];
  const unreadable: string[] = [];
  for (const { videoId, song } of rows) {
    const parsed = readPlaylistYtSong(song);
    if (parsed === null) unreadable.push(videoId);
    else
      songs.push({
        videoId,
        title: parsed.title,
        artists: parsed.artists,
        durationMs: parsed.durationMs,
      });
  }
  return { songs, unreadable, last: rows.at(-1)?.videoId ?? null };
};

export interface DjMoodFeatureWrite {
  readonly videoId: string;
  readonly isrc: string | null;
  readonly features: DjAudioFeatures | null;
  readonly checkedAt: number;
  /** The lookup failed rather than missed: the song is due again after `DJ_MOOD_RETRY_MS`. */
  readonly failed?: boolean;
}

/**
 * Saves misses with their check time (a failed lookup as one due again after
 * `DJ_MOOD_RETRY_MS`); a found feature row is kept forever. A song the catalog
 * pruned since its page was read is skipped, in the same transaction as the writes.
 */
export const keepDjMoodFeatures = (
  db: LibraryDatabase,
  writes: readonly DjMoodFeatureWrite[],
): void => {
  if (writes.length === 0) return;
  db.transaction((tx) => {
    const present = new Set<string>();
    for (const ids of chunks(writes.map(({ videoId }) => videoId)))
      for (const { videoId } of tx
        .select({ videoId: candidateSongs.videoId })
        .from(candidateSongs)
        .where(inArray(candidateSongs.videoId, ids))
        .all())
        present.add(videoId);
    for (const write of writes) {
      if (!present.has(write.videoId)) continue;
      const known = tx
        .select({ energy: djMoodFeatures.energy })
        .from(djMoodFeatures)
        .where(eq(djMoodFeatures.videoId, write.videoId))
        .get();
      if (known?.energy != null) continue;
      const values = {
        isrc: write.isrc,
        energy: write.features?.energy ?? null,
        valence: write.features?.valence ?? null,
        acousticness: write.features?.acousticness ?? null,
        mode: write.features?.mode ?? null,
        // A failed lookup is kept as a miss that expires after the retry wait, not the miss TTL.
        checkedAt: write.failed
          ? write.checkedAt - DJ_MOOD_MISS_TTL_MS + DJ_MOOD_RETRY_MS
          : write.checkedAt,
      };
      tx.insert(djMoodFeatures)
        .values({ videoId: write.videoId, ...values })
        .onConflictDoUpdate({ target: djMoodFeatures.videoId, set: values })
        .run();
    }
  });
};

/** Cached feature rows for the requested videos; misses are omitted. */
export const selectDjMoodFeatures = (
  db: LibraryDatabase,
  videoIds: readonly string[],
): ReadonlyMap<string, DjAudioFeatures> => {
  const found = new Map<string, DjAudioFeatures>();
  for (const ids of chunks(videoIds)) {
    for (const row of db
      .select()
      .from(djMoodFeatures)
      .where(inArray(djMoodFeatures.videoId, ids))
      .all()) {
      if (row.energy == null || row.valence == null || row.acousticness == null) continue;
      if (row.mode !== 0 && row.mode !== 1) continue;
      found.set(row.videoId, {
        energy: row.energy,
        valence: row.valence,
        acousticness: row.acousticness,
        mode: row.mode,
      });
    }
  }
  return found;
};
