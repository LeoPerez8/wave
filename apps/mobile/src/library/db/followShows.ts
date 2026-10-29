import type { LibraryDatabase } from "./database.ts";
import { followShowCache, notifiedFollowShows } from "./schema.ts";
export const readFollowShows = (db: LibraryDatabase) => ({
  artists: db.select().from(followShowCache).all(),
  notified: db
    .select()
    .from(notifiedFollowShows)
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
/** Claim before posting: concurrent checks cannot both notify the same show. */
export const markShowNotified = (db: LibraryDatabase, id: string): boolean =>
  db
    .insert(notifiedFollowShows)
    .values({ id })
    .onConflictDoNothing()
    .returning({ id: notifiedFollowShows.id })
    .get() !== undefined;
