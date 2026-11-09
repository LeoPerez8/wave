/**
 * Normalize Volume's values in the Library: what each song's loudness tags
 * say (Core's `gainTags`, kept by the scan), for the gains the player gets
 * with the queue and for the Library's typical gain.
 */
import { knownGain, type SongLoudness } from "@wave/core";
import { and, inArray, isNotNull } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

const t = schema.tracks;

/** A song with a file and a value of its own. */
const hasValue = and(isNotNull(t.path), isNotNull(t.tagTrackGain));

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
        .select({ id: t.id, trackGainDb: t.tagTrackGain, trackPeak: t.tagTrackPeak })
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
    .select({ trackGainDb: t.tagTrackGain, trackPeak: t.tagTrackPeak })
    .from(t)
    .where(hasValue)
    .all()
    .flatMap((song) => {
      const gain = knownGain(song)?.gainDb;
      return gain === undefined ? [] : [gain];
    });
