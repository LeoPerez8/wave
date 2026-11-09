/**
 * Normalize Volume's values in the Library: what each song's loudness tags
 * say (Core's `gainTags`, kept by the scan), for the gains the player gets
 * with the queue and for the Library's typical gain.
 */
import { knownGain, type SongLoudness } from "@wave/core";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

const t = schema.tracks;

/** A song with a file and a value of its own. */
const currentMeasurement = and(
  isNotNull(t.measuredTrackGain),
  eq(t.measurementSizeBytes, t.sizeBytes),
  or(eq(t.modifiedAt, 0), eq(t.measurementModifiedAt, t.modifiedAt)),
);
const hasValue = and(isNotNull(t.path), or(isNotNull(t.tagTrackGain), currentMeasurement));

/**
 * What's known of the loudness of the songs [ids] (Core's `SongLoudness`), by
 * Track id: those with a file and a value; the others are left out.
 */
export const selectSongLoudness = (
  db: LibraryDatabase,
  ids: readonly number[],
): Map<number, SongLoudness> =>
  new Map(
    chunks([...new Set(ids)]).flatMap((some) =>
      db
        .select({
          id: t.id,
          trackGainDb: t.tagTrackGain,
          trackPeak: t.tagTrackPeak,
          measuredTrackGainDb: sql<number | null>`CASE WHEN ${t.tagTrackGain} IS NULL AND ${t.measurementSizeBytes} = ${t.sizeBytes} AND (${t.modifiedAt} = 0 OR ${t.measurementModifiedAt} = ${t.modifiedAt}) THEN ${t.measuredTrackGain} END`,
          measuredTrackPeak: sql<number | null>`CASE WHEN ${t.tagTrackGain} IS NULL AND ${t.measurementSizeBytes} = ${t.sizeBytes} AND (${t.modifiedAt} = 0 OR ${t.measurementModifiedAt} = ${t.modifiedAt}) THEN ${t.measuredTrackPeak} END`,
        })
        .from(t)
        .where(and(hasValue, inArray(t.id, some)))
        .all()
        .map(({ id, ...loudness }) => [id, loudness] as const),
    ),
  );

/**
 * The gain every Library song with a value plays at (Core's `knownGain`),
 * whose median is the typical gain (`typicalGain`). Missing songs, which have
 * no file, aren't counted.
 */
export const selectLibraryGains = (db: LibraryDatabase): number[] =>
  db
    .select({
      trackGainDb: t.tagTrackGain,
      trackPeak: t.tagTrackPeak,
      measuredTrackGainDb: sql<number | null>`CASE WHEN ${t.measurementSizeBytes} = ${t.sizeBytes} AND (${t.modifiedAt} = 0 OR ${t.measurementModifiedAt} = ${t.modifiedAt}) THEN ${t.measuredTrackGain} END`,
      measuredTrackPeak: sql<number | null>`CASE WHEN ${t.measurementSizeBytes} = ${t.sizeBytes} AND (${t.modifiedAt} = 0 OR ${t.measurementModifiedAt} = ${t.modifiedAt}) THEN ${t.measuredTrackPeak} END`,
    })
    .from(t)
    .where(hasValue)
    .all()
    .flatMap((song) => {
      const gain = knownGain(song)?.gainDb;
      return gain === undefined ? [] : [gain];
    });

export interface MeasurementCandidate {
  readonly id: number;
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
}

/** Untagged queue songs needing work, skipping a failed result until its file fingerprint changes. */
export const selectMeasurementCandidates = (
  db: LibraryDatabase,
  ids: readonly number[],
): MeasurementCandidate[] => {
  if (ids.length === 0) return [];
  const found = db.select({ id: t.id, path: t.path, sizeBytes: t.sizeBytes, modifiedAt: t.modifiedAt })
    .from(t)
    .where(and(
      inArray(t.id, [...new Set(ids)]),
      isNotNull(t.path),
      sql`${t.modifiedAt} != 0`,
      isNull(t.tagTrackGain),
      isNull(t.tagAlbumGain),
      sql`(${t.measurementSizeBytes} IS NULL OR ${t.measurementSizeBytes} != ${t.sizeBytes} OR (${t.modifiedAt} != 0 AND ${t.measurementModifiedAt} != ${t.modifiedAt}))`,
    ))
    .all() as MeasurementCandidate[];
  const byId = new Map(found.map((row) => [row.id, row]));
  return [...new Set(ids)].flatMap((id) => {
    const candidate = byId.get(id);
    return candidate === undefined ? [] : [candidate];
  });
};

/** Commits a result only while the Track still names the file that was decoded. */
export const saveMeasurement = (
  db: LibraryDatabase,
  candidate: MeasurementCandidate,
  result: { readonly gainDb: number | null; readonly peak: number | null },
): boolean => {
  const update = db.update(t).set({
    measuredTrackGain: result.gainDb,
    measuredTrackPeak: result.peak,
    measurementSizeBytes: candidate.sizeBytes,
    measurementModifiedAt: candidate.modifiedAt,
    measurementFailed: result.gainDb === null ? true : false,
  }).where(and(
    eq(t.id, candidate.id),
    eq(t.path, candidate.path),
    eq(t.sizeBytes, candidate.sizeBytes),
    eq(t.modifiedAt, candidate.modifiedAt),
    isNull(t.tagTrackGain),
    isNull(t.tagAlbumGain),
  )).returning({ id: t.id }).all();
  return update.length > 0;
};
