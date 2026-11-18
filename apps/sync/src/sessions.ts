/**
 * How sessions expire. A session unused for `SESSION_UNUSED_MS` is no longer
 * valid: a request with it answers 401 and deletes it, a sign-in to its
 * account deletes it, and the hourly maintenance deletes it without its token
 * having to come back.
 */

import type { Client } from "@libsql/client";

/** How long a session lasts unused: any authenticated request starts it again. */
export const SESSION_UNUSED_MS = 90 * 24 * 60 * 60 * 1000;

/** Deletes every account's sessions unused for `SESSION_UNUSED_MS` at [at]; valid ones stay. */
export const removeExpiredSessions = async (db: Client, at: number): Promise<void> => {
  await db.execute({
    sql: "DELETE FROM sessions WHERE last_used_at <= ?",
    args: [at - SESSION_UNUSED_MS],
  });
};
