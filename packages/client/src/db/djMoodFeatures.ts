/** Phone-local ReccoBeats feature cache for songs in the candidate catalog. */
import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import type { DjAudioFeatures } from "@wave/core";

import type { LibraryDatabase } from "./database.ts";
import { candidateSongs, djMoodFeatures } from "./schema.ts";
import { readPlaylistYtSong } from "@wave/core";
import { chunks } from "./chunks.ts";

export const DJ_MOOD_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DJ_MOOD_PAGE_SIZE = 40;

export interface DjMoodLookupSong {
  readonly videoId: string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly durationMs: number | null;
}

/** Candidate songs with no answer, or an expired miss, in video-id order. */
export const pendingDjMoodSongs = (
  db: LibraryDatabase,
  after: string,
  now: number,
  limit = DJ_MOOD_PAGE_SIZE,
): DjMoodLookupSong[] =>
  db
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
    .all()
    .flatMap(({ videoId, song }) => {
      const parsed = readPlaylistYtSong(song);
      return parsed === null
        ? []
        : [
            {
              videoId,
              title: parsed.title,
              artists: parsed.artists,
              durationMs: parsed.durationMs,
            },
          ];
    });

export interface DjMoodFeatureWrite {
  readonly videoId: string;
  readonly isrc: string | null;
  readonly features: DjAudioFeatures | null;
  readonly checkedAt: number;
}

/** Saves misses with their check time; a found feature row is kept forever. */
export const keepDjMoodFeatures = (
  db: LibraryDatabase,
  writes: readonly DjMoodFeatureWrite[],
): void => {
  for (const write of writes) {
    const known = db
      .select({ energy: djMoodFeatures.energy })
      .from(djMoodFeatures)
      .where(eq(djMoodFeatures.videoId, write.videoId))
      .get();
    if (known?.energy != null) continue;
    db.insert(djMoodFeatures)
      .values({
        videoId: write.videoId,
        isrc: write.isrc,
        energy: write.features?.energy ?? null,
        valence: write.features?.valence ?? null,
        acousticness: write.features?.acousticness ?? null,
        mode: write.features?.mode ?? null,
        checkedAt: write.checkedAt,
      })
      .onConflictDoUpdate({
        target: djMoodFeatures.videoId,
        set: {
          isrc: write.isrc,
          energy: write.features?.energy ?? null,
          valence: write.features?.valence ?? null,
          acousticness: write.features?.acousticness ?? null,
          mode: write.features?.mode ?? null,
          checkedAt: write.checkedAt,
        },
      })
      .run();
  }
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
