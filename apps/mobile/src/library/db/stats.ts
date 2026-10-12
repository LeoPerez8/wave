/**
 * The play totals Stats ranks, as thin queries over the library database:
 * they only filter (counted plays in a window, tracks still in the library)
 * and sum. Ordering and the cut-off are Core's `rankPlays`. Kept free of Expo
 * so the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import type { PlayTotals, StatsWindow } from "@wave/core";
import { and, eq, gte, lte, sql, type SQL } from "drizzle-orm";

import type { LibraryDatabase } from "./playHistory.ts";
import * as schema from "./schema.ts";

/** Counted plays that started within `window`. */
const countedIn = (window: StatsWindow): SQL | undefined => {
  const { playEvents } = schema;
  return and(
    eq(playEvents.counted, true),
    window.from === null ? undefined : gte(playEvents.startedAt, window.from),
    lte(playEvents.startedAt, window.to),
  );
};

/** What every aggregate sums over its counted plays. */
const sums = {
  countedPlays: sql<number>`count(*)`,
  listenedMs: sql<number>`sum(${schema.playEvents.listenedMs})`,
  latestPlayAt: sql<number>`max(${schema.playEvents.startedAt})`,
};

/** Each track's counted plays within `window`, for tracks still in the library, in no order. */
export const trackPlayTotals = (db: LibraryDatabase, window: StatsWindow): PlayTotals[] => {
  const { playEvents, tracks } = schema;
  return db
    .select({ id: tracks.id, sortKey: tracks.titleSort, ...sums })
    .from(playEvents)
    .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
    .where(countedIn(window))
    .groupBy(tracks.id)
    .all();
};
