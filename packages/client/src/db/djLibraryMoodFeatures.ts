/**
 * Phone-local ReccoBeats features for Library songs, found by their file's ISRC tag or by the
 * video they were downloaded from.
 */
import { and, asc, eq, gt, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import type { DjAudioFeatures } from "@wave/core";

import type { LibraryDatabase } from "./database.ts";
import { djLibraryMoodFeatures, djMoodFeatures, tracks } from "./schema.ts";

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

/** A feature row's four fields, or null when it's a miss or malformed. */
const featuresOf = (row: {
  readonly energy: number | null;
  readonly valence: number | null;
  readonly acousticness: number | null;
  readonly mode: number | null;
}): DjAudioFeatures | null =>
  row.energy == null || row.valence == null || row.acousticness == null
    ? null
    : row.mode !== 0 && row.mode !== 1
      ? null
      : {
          energy: row.energy,
          valence: row.valence,
          acousticness: row.acousticness,
          mode: row.mode,
        };

/**
 * Every Library song's found features, by Track id as Core's candidates name it (`String(id)`):
 * the stream features of the video it was downloaded from, else its ISRC tag's, as a batch
 * prefers a stream song's features to its Library match's. A Library stand-in reads the same.
 */
export const selectDjLibraryMoodFeatures = (
  db: LibraryDatabase,
): ReadonlyMap<string, DjAudioFeatures> => {
  const found = new Map<string, DjAudioFeatures>();
  const columns = (table: typeof djLibraryMoodFeatures | typeof djMoodFeatures) => ({
    trackId: tracks.id,
    energy: table.energy,
    valence: table.valence,
    acousticness: table.acousticness,
    mode: table.mode,
  });
  const tagged = db
    .select(columns(djLibraryMoodFeatures))
    .from(djLibraryMoodFeatures)
    .innerJoin(
      tracks,
      and(
        eq(tracks.id, djLibraryMoodFeatures.trackId),
        eq(tracks.isrc, djLibraryMoodFeatures.isrc),
      ),
    )
    .where(isNotNull(djLibraryMoodFeatures.energy))
    .all();
  const streamed = db
    .select(columns(djMoodFeatures))
    .from(djMoodFeatures)
    .innerJoin(tracks, eq(tracks.videoId, djMoodFeatures.videoId))
    .where(isNotNull(djMoodFeatures.energy))
    .all();
  // The stream features come last, so they replace the ISRC tag's.
  for (const row of [...tagged, ...streamed]) {
    const features = featuresOf(row);
    if (features !== null) found.set(String(row.trackId), features);
  }
  return found;
};
