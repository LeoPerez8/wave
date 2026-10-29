import { followArtistKey, type FollowedArtist, type FollowLevel } from "@wave/core";
import { eq, sql } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { follows } from "./schema.ts";

export interface FollowTarget {
  readonly name: string;
  readonly deezerId?: number | null;
  readonly ytBrowseId?: string | null;
}
export const selectFollow = (db: LibraryDatabase, name: string): FollowedArtist | null =>
  db
    .select()
    .from(follows)
    .where(eq(follows.key, followArtistKey(name)))
    .get() ?? null;
export const countFollows = (db: LibraryDatabase): number =>
  db
    .select({ count: sql<number>`count(*)` })
    .from(follows)
    .get()!.count;
export const selectFollows = (db: LibraryDatabase): FollowedArtist[] =>
  db
    .select()
    .from(follows)
    .all()
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort((a, b) => a.key.localeCompare(b.key));
export const saveFollow = (
  db: LibraryDatabase,
  target: FollowTarget,
  level: FollowLevel,
  now: number,
): void => {
  const previous = selectFollow(db, target.name);
  const row: FollowedArtist = {
    key: followArtistKey(target.name),
    name: previous?.name ?? target.name,
    level,
    followedAt: previous?.followedAt ?? now,
    deezerId: target.deezerId ?? previous?.deezerId ?? null,
    ytBrowseId: target.ytBrowseId ?? previous?.ytBrowseId ?? null,
  };
  db.insert(follows).values(row).onConflictDoUpdate({ target: follows.key, set: row }).run();
};
export const removeFollow = (db: LibraryDatabase, name: string): void => {
  db.delete(follows)
    .where(eq(follows.key, followArtistKey(name)))
    .run();
};
