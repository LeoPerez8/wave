import { eq } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { followShowCache, notifiedFollowShows } from "./schema.ts";
import { stamped } from "./sync.ts";
export const readFollowShows = (db: LibraryDatabase) => ({
  artists: db.select().from(followShowCache).all(),
  notified: db
    .select({ id: notifiedFollowShows.id })
    .from(notifiedFollowShows)
    .where(eq(notifiedFollowShows.deleted, false))
    .all()
    .map((r) => r.id),
});
export type FollowShowCacheRow = typeof followShowCache.$inferInsert;
export const saveFollowShows = (db: LibraryDatabase, row: FollowShowCacheRow): void => {
  db.insert(followShowCache)
    .values(row)
    .onConflictDoUpdate({ target: followShowCache.key, set: row })
    .run();
};
/**
 * Claim before posting: concurrent checks cannot both notify the same show,
 * and a claim synced from another phone of the Wave account holds here too.
 */
export const markShowNotified = (db: LibraryDatabase, id: string, now: number): boolean =>
  db
    .insert(notifiedFollowShows)
    .values({ id, changedAt: now })
    .onConflictDoUpdate({
      target: notifiedFollowShows.id,
      set: { deleted: false, ...stamped(notifiedFollowShows, now) },
      setWhere: eq(notifiedFollowShows.deleted, true),
    })
    .returning({ id: notifiedFollowShows.id })
    .get() !== undefined;
