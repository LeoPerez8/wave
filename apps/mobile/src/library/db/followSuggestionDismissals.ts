import { and, asc, eq } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { dismissedFollowSuggestions } from "./schema.ts";
import { stamped } from "./sync.ts";

const live = eq(dismissedFollowSuggestions.deleted, false);

/** The follow keys of the suggestions the owner dismissed, in key order. */
export const selectDismissedFollowSuggestions = (db: LibraryDatabase): string[] =>
  db
    .select({ key: dismissedFollowSuggestions.key })
    .from(dismissedFollowSuggestions)
    .where(live)
    .orderBy(asc(dismissedFollowSuggestions.key))
    .all()
    .map((row) => row.key);

/**
 * Dismisses the suggestion of the artist with follow key [key] at [now];
 * dismissing one already dismissed changes nothing.
 */
export const dismissFollowSuggestion = (db: LibraryDatabase, key: string, now: number): void => {
  db.insert(dismissedFollowSuggestions)
    .values({ key, dismissedAt: now, changedAt: now })
    .onConflictDoUpdate({
      target: dismissedFollowSuggestions.key,
      set: { deleted: false, dismissedAt: now, ...stamped(dismissedFollowSuggestions, now) },
      setWhere: eq(dismissedFollowSuggestions.deleted, true),
    })
    .run();
};

/** Undo after a dismissal: the row stays as a tombstone, as an unfollow's does. */
export const undoFollowSuggestionDismissal = (
  db: LibraryDatabase,
  key: string,
  now: number,
): void => {
  db.update(dismissedFollowSuggestions)
    .set({ deleted: true, ...stamped(dismissedFollowSuggestions, now) })
    .where(and(eq(dismissedFollowSuggestions.key, key), live))
    .run();
};
