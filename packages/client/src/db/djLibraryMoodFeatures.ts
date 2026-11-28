/**
 * Phone-local ReccoBeats features for Library songs, found by their file's ISRC tag or by the
 * video they were downloaded from.
 */
import { and, asc, eq, gt, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  djMoodFeaturesSteps,
  finishSteps,
  type DjAudioFeatures,
  type DjMoodFeatureRow,
} from "@wave/core";

import type { LibraryDatabase } from "./database.ts";
import { djLibraryMoodFeatures, tracks } from "./schema.ts";

/** A miss is asked about again after 30 days, as candidate songs' misses are. */
export const DJ_LIBRARY_MOOD_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DJ_LIBRARY_MOOD_PAGE_SIZE = 40;

export interface DjLibraryMoodSong {
  readonly trackId: number;
  readonly isrc: string;
}

/**
 * Library songs with an ISRC tag and no answer for it (never asked, asked for another ISRC, or a
 * miss older than 30 days), in Track-id order after [afterTrackId].
 */
export const pendingDjLibraryMoodSongs = (
  db: LibraryDatabase,
  afterTrackId: number,
  now: number,
  limit = DJ_LIBRARY_MOOD_PAGE_SIZE,
): DjLibraryMoodSong[] =>
  db
    .select({ trackId: tracks.id, isrc: tracks.isrc })
    .from(tracks)
    .leftJoin(djLibraryMoodFeatures, eq(djLibraryMoodFeatures.trackId, tracks.id))
    .where(
      and(
        gt(tracks.id, afterTrackId),
        isNotNull(tracks.path),
        isNotNull(tracks.isrc),
        or(
          isNull(djLibraryMoodFeatures.trackId),
          ne(djLibraryMoodFeatures.isrc, tracks.isrc),
          and(
            isNull(djLibraryMoodFeatures.energy),
            lte(djLibraryMoodFeatures.checkedAt, now - DJ_LIBRARY_MOOD_MISS_TTL_MS),
          ),
        ),
      ),
    )
    .orderBy(asc(tracks.id))
    .limit(limit)
    .all()
    .flatMap(({ trackId, isrc }) => (isrc === null ? [] : [{ trackId, isrc }]));

export interface DjLibraryMoodFeatureWrite {
  readonly trackId: number;
  readonly isrc: string;
  readonly features: DjAudioFeatures | null;
  readonly checkedAt: number;
}

/**
 * Saves each answer against its Library track: a match for the same ISRC is kept for good, a
 * miss keeps its check time. A Track deleted meanwhile is skipped.
 */
export const keepDjLibraryMoodFeatures = (
  db: LibraryDatabase,
  writes: readonly DjLibraryMoodFeatureWrite[],
): void => {
  for (const write of writes) {
    const known = db
      .select({ isrc: djLibraryMoodFeatures.isrc, energy: djLibraryMoodFeatures.energy })
      .from(djLibraryMoodFeatures)
      .where(eq(djLibraryMoodFeatures.trackId, write.trackId))
      .get();
    if (known?.isrc === write.isrc && known.energy != null) continue;
    const exists = db
      .select({ id: tracks.id })
      .from(tracks)
      .where(eq(tracks.id, write.trackId))
      .get();
    if (exists === undefined) continue;
    const values = {
      isrc: write.isrc,
      energy: write.features?.energy ?? null,
      valence: write.features?.valence ?? null,
      acousticness: write.features?.acousticness ?? null,
      mode: write.features?.mode ?? null,
      checkedAt: write.checkedAt,
    };
    db.insert(djLibraryMoodFeatures)
      .values({ trackId: write.trackId, ...values })
      .onConflictDoUpdate({ target: djLibraryMoodFeatures.trackId, set: values })
      .run();
  }
};

/**
 * Every Library song's kept feature rows, by Track id as Core's candidates name it
 * (`String(id)`): its ISRC tag's first, then the stream features of the video it was downloaded
 * from, which replace them in Core's `djMoodFeaturesSteps`, as a batch prefers a stream song's
 * features to its Library match's. One statement, so a replayed read runs twice (#1532).
 */
export const djLibraryMoodFeatureRows = (db: LibraryDatabase): DjMoodFeatureRow[] =>
  db.all<DjMoodFeatureRow>(sql`SELECT id, energy, valence, acousticness, mode FROM (
      SELECT CAST(tracks.id AS TEXT) AS id, f.energy, f.valence, f.acousticness, f.mode, 0 AS stream
        FROM dj_library_mood_features f
        JOIN tracks ON tracks.id = f.track_id AND tracks.isrc = f.isrc
        WHERE f.energy IS NOT NULL
      UNION ALL
      SELECT CAST(tracks.id AS TEXT), f.energy, f.valence, f.acousticness, f.mode, 1
        FROM dj_mood_features f
        JOIN tracks ON tracks.video_id = f.video_id
        WHERE f.energy IS NOT NULL)
    ORDER BY stream`);

/** Every Library song's found features (`djLibraryMoodFeatureRows`). A Library stand-in reads the same. */
export const selectDjLibraryMoodFeatures = (
  db: LibraryDatabase,
): ReadonlyMap<string, DjAudioFeatures> =>
  finishSteps(djMoodFeaturesSteps(djLibraryMoodFeatureRows(db)));
