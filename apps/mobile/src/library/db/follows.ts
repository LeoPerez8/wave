import { followArtistKey, type FollowedArtist, type FollowLevel } from "@wave/core";
import { and, eq, sql } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { follows } from "./schema.ts";
import { stamped } from "./sync.ts";

export interface FollowTarget {
  readonly name: string;
  readonly deezerId?: number | null;
  readonly ytBrowseId?: string | null;
}
const followFields = {
  key: follows.key,
  name: follows.name,
  level: follows.level,
  followedAt: follows.followedAt,
  deezerId: follows.deezerId,
  ytBrowseId: follows.ytBrowseId,
};
const live = eq(follows.deleted, false);
export const selectFollow = (db: LibraryDatabase, name: string): FollowedArtist | null =>
  db
    .select(followFields)
    .from(follows)
    .where(and(eq(follows.key, followArtistKey(name)), live))
    .get() ?? null;
export const countFollows = (db: LibraryDatabase): number =>
  db
    .select({ count: sql<number>`count(*)` })
    .from(follows)
    .where(live)
    .get()!.count;
export const selectFollows = (db: LibraryDatabase): FollowedArtist[] =>
  db
    .select(followFields)
    .from(follows)
    .where(live)
    .all()
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort((a, b) => a.key.localeCompare(b.key));
/**
 * Follows [target] at [level]. Equivalent names merge ids and keep the first
 * name and date; a change waits to sync, saving what's there already doesn't
 * (false: nothing changed).
 */
export const saveFollow = (
  db: LibraryDatabase,
  target: FollowTarget,
  level: FollowLevel,
  now: number,
): boolean => {
  const previous = selectFollow(db, target.name);
  const row: FollowedArtist = {
    key: followArtistKey(target.name),
    name: previous?.name ?? target.name,
    level,
    followedAt: previous?.followedAt ?? now,
    deezerId: target.deezerId ?? previous?.deezerId ?? null,
    ytBrowseId: target.ytBrowseId ?? previous?.ytBrowseId ?? null,
  };
  if (
    previous !== null &&
    previous.level === row.level &&
    previous.deezerId === row.deezerId &&
    previous.ytBrowseId === row.ytBrowseId
  ) {
    return false;
  }
  db.insert(follows)
    .values({ ...row, changedAt: now })
    .onConflictDoUpdate({
      target: follows.key,
      set: { ...row, deleted: false, ...stamped(follows, now) },
    })
    .run();
  return true;
};
/** Unfollows: the follow stays as a tombstone until the Wave account has it. */
export const removeFollow = (db: LibraryDatabase, name: string, now: number): void => {
  db.update(follows)
    .set({ deleted: true, ...stamped(follows, now) })
    .where(and(eq(follows.key, followArtistKey(name)), live))
    .run();
};
