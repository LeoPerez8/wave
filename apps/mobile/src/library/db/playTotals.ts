/**
 * Each played track's all-time listening (`play_totals`), which SQLite keeps
 * as plays are written (the triggers of migration `0023_play_totals`), so
 * Home's all-time summaries read a row per played song, or a few of them,
 * rather than every play. Kept free of Expo so the store tests run it against
 * a real SQLite (`testDatabase.ts`).
 */
import type { ListeningSums } from "@wave/core";
import { and, gt, inArray, sql } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** `play_totals`' columns, in the order `SUMMED` gives them. */
const COLUMNS = sql`track_id, plays, counted_plays, listened_ms, counted_listened_ms,
  last_played_at, last_counted_at, album_id`;

/** Each played track's totals summed from its plays, as the triggers keep them. */
const SUMMED = sql`
  SELECT track_id, count(*), sum(CASE WHEN counted THEN 1 ELSE 0 END), sum(listened_ms),
    sum(CASE WHEN counted THEN listened_ms ELSE 0 END), max(started_at),
    max(CASE WHEN counted THEN started_at END), max(CASE WHEN counted THEN album_id END)
  FROM play_events GROUP BY track_id`;

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
 * plays, songs still in the library with a counted play, the latest play.
 * Songs since removed keep their time and plays.
 */
export const listeningSums = (db: LibraryDatabase): ListeningSums =>
  db.get<ListeningSums>(sql`
    SELECT coalesce(sum(listened_ms), 0) AS "listenedMs",
      coalesce(sum(counted_plays), 0) AS "countedPlays",
      (SELECT count(*) FROM play_totals JOIN tracks ON tracks.id = play_totals.track_id
        WHERE play_totals.counted_plays > 0) AS "songsListened",
      max(last_played_at) AS "lastPlayedAt"
    FROM play_totals`);

/**
 * Each of the songs [ids]' counted plays, by song id; those never counted are
 * left out. What a Magic Queue from an album or a playlist draws its radios by.
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
