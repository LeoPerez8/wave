/**
 * Each played track's all-time listening (`play_totals`), which SQLite keeps
 * as plays are written (the triggers of migration `0023_play_totals`), so
 * Home's all-time summaries read a row per played song, or a few of them,
 * rather than every play. Kept free of Expo so the store tests run it against
 * a real SQLite (`testDatabase.ts`).
 */
import { mergeCountedPlays, parseTrackId, type ListeningSums } from "@wave/core";
import { and, gt, inArray, sql } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { streamedTrack } from "./stats.ts";

/** `play_totals`' columns, in the order `SUMMED` gives them. */
const COLUMNS = sql`track_id, plays, counted_plays, listened_ms, counted_listened_ms,
  last_played_at, last_counted_at, album_id`;

/** Each played track's totals summed from its plays, as the triggers keep them. */
const SUMMED = sql`
  SELECT track_id, count(*), sum(CASE WHEN counted THEN 1 ELSE 0 END), sum(listened_ms),
    sum(CASE WHEN counted THEN listened_ms ELSE 0 END), max(started_at),
    max(CASE WHEN counted THEN started_at END), max(CASE WHEN counted THEN album_id END)
  FROM play_events WHERE track_id IS NOT NULL GROUP BY track_id`;

/**
 * The tracks whose kept totals differ from their history, by id: none, unless
 * something wrote `play_totals` or `play_events` past the triggers. Reads the
 * whole history; for checks, not for screens.
 */
export const playTotalsDrift = (db: LibraryDatabase): number[] =>
  db
    .all<{ trackId: number }>(
      sql`WITH history AS (${SUMMED}), kept AS (SELECT ${COLUMNS} FROM play_totals)
        SELECT track_id AS "trackId" FROM (SELECT * FROM kept EXCEPT SELECT * FROM history)
        UNION SELECT track_id FROM (SELECT * FROM history EXCEPT SELECT * FROM kept)
        ORDER BY 1`,
    )
    .map((row) => row.trackId);

/** Sums every track's totals again from the history, as migration `0023_play_totals` first did. */
export const rebuildPlayTotals = (db: LibraryDatabase): void => {
  db.transaction((tx) => {
    tx.run(sql`DELETE FROM play_totals`);
    tx.run(sql`INSERT INTO play_totals (${COLUMNS}) ${SUMMED}`);
  });
};

/**
 * The whole history's listening, summed in one row (Core's
 * `summedListeningTotals` reads it): time listened over every play, counted
 * plays, songs with a counted play, the latest play; streamed plays included.
 * A song listened is one in the library, or a streamed song: one whose
 * streamed plays are a Library song's (`streamedTrack`) is that song, once.
 * Songs since removed keep their time and plays.
 */
export const listeningSums = (db: LibraryDatabase): ListeningSums =>
  db.get<ListeningSums>(sql`
    WITH totals AS (
      SELECT listened_ms, counted_plays, last_played_at FROM play_totals
      UNION ALL
      SELECT listened_ms, counted_plays, last_played_at FROM streamed_totals
    ), streamed AS (
      SELECT video_id,
        ${streamedTrack(sql`streamed_totals.video_id`, sql`nullif(streamed_totals.recording_key, '')`)} AS track_id
      FROM streamed_totals WHERE counted_plays > 0
    ), listened AS (
      SELECT play_totals.track_id AS song FROM play_totals JOIN tracks ON tracks.id = play_totals.track_id
        WHERE play_totals.counted_plays > 0
      UNION SELECT track_id FROM streamed WHERE track_id IS NOT NULL
      UNION SELECT 'yt:' || video_id FROM streamed WHERE track_id IS NULL
    )
    SELECT coalesce(sum(listened_ms), 0) AS "listenedMs",
      coalesce(sum(counted_plays), 0) AS "countedPlays",
      (SELECT count(*) FROM listened) AS "songsListened",
      max(last_played_at) AS "lastPlayedAt"
    FROM totals`);

/**
 * Each of the songs [trackIds]' counted plays over all time, by queue track id
 * (a Library song's id, or `yt:` and a streamed song's video id); those never
 * counted are left out. A Library song's include the streamed plays that are
 * its own (`streamedTrack`), and a streamed song the Library has counts as
 * that Library song, streamed before or not (Core's `mergeCountedPlays`). What Smart Shuffle and a Magic Queue's seeds weigh songs
 * by. Reads the kept totals: a row per played song, never the play history.
 */
export const songCountedPlays = (
  db: LibraryDatabase,
  trackIds: readonly string[],
): Map<string, number> => {
  const wanted = new Set<number>();
  const videos = new Set<string>();
  for (const id of trackIds) {
    const ref = parseTrackId(id);
    if (ref?.kind === "library") wanted.add(ref.id);
    else if (ref?.kind === "yt") videos.add(ref.videoId);
  }
  if (wanted.size === 0 && videos.size === 0) return new Map();
  // Every streamed song's plays, and the Library song they're now, as listeningSums reads them.
  const streamed = db.all<{ videoId: string; trackId: number | null; countedPlays: number }>(sql`
    SELECT video_id AS "videoId", counted_plays AS "countedPlays",
      ${streamedTrack(sql`streamed_totals.video_id`, sql`nullif(streamed_totals.recording_key, '')`)} AS "trackId"
    FROM streamed_totals WHERE counted_plays > 0`);
  // The Library song a queued video is when it was never streamed: a download played from its file.
  const libraryVideos = new Map(
    chunks([...videos]).flatMap((some) =>
      db
        .select({ videoId: schema.tracks.videoId, id: sql<number>`min(${schema.tracks.id})` })
        .from(schema.tracks)
        .where(inArray(schema.tracks.videoId, some))
        .groupBy(schema.tracks.videoId)
        .all()
        .map(({ videoId, id }) => [videoId!, id] as const),
    ),
  );
  for (const row of streamed) if (row.trackId !== null) wanted.add(row.trackId);
  for (const id of libraryVideos.values()) wanted.add(id);
  const library = chunks([...wanted]).flatMap((some) =>
    db
      .select({ id: schema.playTotals.trackId, countedPlays: schema.playTotals.countedPlays })
      .from(schema.playTotals)
      .where(inArray(schema.playTotals.trackId, some))
      .all(),
  );
  const sums = { listenedMs: 0, latestPlayAt: 0 };
  const merged = mergeCountedPlays({
    library: library.map((row) => ({ ...row, ...sums })),
    streamed: streamed.map((row) => ({ ...row, ...sums })),
    libraryVideos,
  });
  const plays = new Map<string, number>();
  for (const id of trackIds) {
    const count = merged.of(id)?.countedPlays ?? 0;
    if (count > 0) plays.set(id, count);
  }
  return plays;
};

/**
 * Each of the songs [ids]' counted plays, by song id; those never counted are
 * left out. What Discover's mixes draw their seeds by.
 */
export const selectCountedPlays = (
  db: LibraryDatabase,
  ids: readonly number[],
): Map<number, number> =>
  new Map(
    chunks(ids).flatMap((some) =>
      db
        .select({ id: schema.playTotals.trackId, plays: schema.playTotals.countedPlays })
        .from(schema.playTotals)
        .where(and(inArray(schema.playTotals.trackId, some), gt(schema.playTotals.countedPlays, 0)))
        .all()
        .map(({ id, plays }) => [id, plays] as const),
    ),
  );
