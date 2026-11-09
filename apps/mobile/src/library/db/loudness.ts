/**
 * Normalize Volume's values in the Library: what each song's loudness tags
 * say (Core's `gainTags`, kept by the scan) and, for a file without tags,
 * Wave's own measurement of it, for the gains the player gets with the queue
 * and for the Library's typical gain.
 *
 * A measurement is kept with the size and modified time of the file it was
 * made of (`measuredSizeBytes`, `measuredModifiedAt`); a file Wave couldn't
 * measure has them without a loudness. The scan's save drops all of it when
 * it sees the file change (`saveBatch`), so what's here describes the file
 * the Track has now. Measurements stay on this phone and never sync.
 */
import { knownGain, type AlbumLoudness, type SongLoudness } from "@wave/core";
import { and, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

const t = schema.tracks;

/** A song with a file and a value of its own: its tags', or else Wave's measurement. */
const hasValue = and(
  isNotNull(t.path),
  or(isNotNull(t.tagTrackGain), isNotNull(t.measuredLoudness)),
);

const loudnessColumns = {
  trackGainDb: t.tagTrackGain,
  trackPeak: t.tagTrackPeak,
  measuredLoudness: t.measuredLoudness,
  measuredPeak: t.measuredPeak,
};

interface LoudnessRow {
  readonly trackGainDb: number | null;
  readonly trackPeak: number | null;
  readonly measuredLoudness: number | null;
  readonly measuredPeak: number | null;
}

/** A row's value: its tags' when it has them (they win), else its measurement. */
const songLoudness = (row: LoudnessRow): SongLoudness =>
  row.trackGainDb !== null
    ? { trackGainDb: row.trackGainDb, trackPeak: row.trackPeak }
    : { measuredLoudness: row.measuredLoudness, measuredPeak: row.measuredPeak };

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
        .select({ id: t.id, ...loudnessColumns })
        .from(t)
        .where(and(hasValue, inArray(t.id, some)))
        .all()
        .map(({ id, ...row }) => [id, songLoudness(row)] as const),
    ),
  );

/**
 * The gain every Library song with a value plays at (Core's `knownGain`),
 * whose median is the typical gain (`typicalGain`). Missing songs, which have
 * no file, aren't counted.
 */
export const selectLibraryGains = (db: LibraryDatabase): number[] =>
  db
    .select(loudnessColumns)
    .from(t)
    .where(hasValue)
    .all()
    .flatMap((row) => {
      const gain = knownGain(songLoudness(row))?.gainDb;
      return gain === undefined ? [] : [gain];
    });

/** A Library file to measure, as the scan last saw it. */
export interface SongToMeasure {
  readonly id: number;
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
}

/**
 * What measuring a file gave: its integrated loudness in LUFS and its sample
 * peak (0–1 full scale), or null when it couldn't be decoded.
 */
export type SongMeasurement = { readonly loudness: number; readonly peak: number } | null;

/** A Library file without tags not measured, or tried, as it is now, that the scan has read. */
const toMeasure = and(
  isNotNull(t.path),
  ne(t.modifiedAt, 0),
  isNull(t.tagTrackGain),
  isNull(t.measuredSizeBytes),
);

const toMeasureColumns = {
  id: t.id,
  path: t.path,
  sizeBytes: t.sizeBytes,
  modifiedAt: t.modifiedAt,
};

/**
 * The songs among [ids], in their order, that Wave should measure: Library
 * files without tags that haven't been measured, or tried, as they are now. A
 * file the scan was asked to read again (a migration's `modified_at = 0`)
 * waits until it has, as its tags may give it a value.
 */
export const selectSongsToMeasure = (
  db: LibraryDatabase,
  ids: readonly number[],
): SongToMeasure[] => {
  const wanted = [...new Set(ids)];
  const found = new Map<number, SongToMeasure>();
  for (const some of chunks(wanted)) {
    const rows = db
      .select(toMeasureColumns)
      .from(t)
      .where(and(inArray(t.id, some), toMeasure))
      .all();
    for (const { path, ...row } of rows) if (path !== null) found.set(row.id, { ...row, path });
  }
  return wanted.flatMap((id) => {
    const song = found.get(id);
    return song === undefined ? [] : [song];
  });
};

/**
 * Keeps what measuring [song] gave ([measurement]; null: it couldn't be
 * measured) with the file's size and modified time. False, keeping nothing,
 * when the Track no longer has that file as it was, or has tags now.
 */
export const saveMeasurement = (
  db: LibraryDatabase,
  song: SongToMeasure,
  measurement: SongMeasurement,
): boolean =>
  db
    .update(t)
    .set({
      measuredLoudness: measurement?.loudness ?? null,
      measuredPeak: measurement?.peak ?? null,
      measuredSizeBytes: song.sizeBytes,
      measuredModifiedAt: song.modifiedAt,
    })
    .where(
      and(
        eq(t.id, song.id),
        eq(t.path, song.path),
        eq(t.sizeBytes, song.sizeBytes),
        eq(t.modifiedAt, song.modifiedAt),
        isNull(t.tagTrackGain),
      ),
    )
    .returning({ id: t.id })
    .all().length > 0;

/**
 * All Library songs filed under this local album id. Missing songs stay in
 * the result without values, so they prevent premature album completion.
 * Reads fresh values after measurements without publishing a Library change.
 */
export const selectAlbumLoudness = (db: LibraryDatabase, id: number): AlbumLoudness | null => {
  const rows = db
    .select({
      id: t.id,
      path: t.path,
      durationMs: t.durationMs,
      ...loudnessColumns,
      albumGainDb: t.tagAlbumGain,
      albumPeak: t.tagAlbumPeak,
    })
    .from(t)
    .where(eq(t.albumId, id))
    .orderBy(t.discNumber, t.trackNumber, t.id)
    .all();
  if (rows.length === 0) return null;
  return {
    id: String(id),
    songs: rows.map(({ path, id, durationMs, albumGainDb, albumPeak, ...row }) => ({
      id,
      durationMs,
      ...(path === null ? {} : { ...songLoudness(row), albumGainDb, albumPeak }),
    })),
  };
};

/**
 * Every Library file Wave should measure, oldest first: what the charging job
 * works through (`selectSongsToMeasure` reads the same for the queue's songs).
 */
export const selectLibraryToMeasure = (db: LibraryDatabase): SongToMeasure[] =>
  db
    .select(toMeasureColumns)
    .from(t)
    .where(toMeasure)
    .orderBy(t.id)
    .all()
    .flatMap(({ path, ...row }) => (path === null ? [] : [{ ...row, path }]));

/** A file the charging job measured, and what that gave. */
export interface MeasuredSong {
  readonly song: SongToMeasure;
  readonly measurement: SongMeasurement;
}

/**
 * Keeps what the charging job measured, in one transaction (`saveMeasurement`
 * for each); the Track ids kept, leaving out files that changed since.
 */
export const saveMeasurements = (
  db: LibraryDatabase,
  measured: readonly MeasuredSong[],
): number[] =>
  db.transaction((tx) =>
    measured.flatMap(({ song, measurement }) =>
      saveMeasurement(tx, song, measurement) ? [song.id] : [],
    ),
  );
