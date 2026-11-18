/**
 * The hourly maintenance (the Worker's Cron Trigger): it deletes sessions
 * unused for 90 days and runs the usage watch (src/usage.ts). Each task runs
 * whatever happens to the other, so missing or failing analytics never stops
 * the session cleanup. No line it writes carries a token or an account.
 */

import type { Client } from "@libsql/client";
import { removeExpiredSessions } from "./sessions.ts";
import { type UsageSecrets, type UsageWatchOptions, watchUsage } from "./usage.ts";

export interface MaintenanceOptions {
  readonly db: Client;
  readonly secrets: UsageSecrets;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Where warning lines go (`console.error` by default). */
  readonly warn?: (message: string) => void;
  /** Where other lines go (`console.log` by default). */
  readonly note?: (message: string) => void;
}

export const runMaintenance = async (options: MaintenanceOptions): Promise<void> => {
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => console.error(message));
  const watch: UsageWatchOptions = {
    db: options.db,
    secrets: options.secrets,
    now,
    warn,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.note === undefined ? {} : { note: options.note }),
  };
  const [sessions, usage] = await Promise.allSettled([
    removeExpiredSessions(options.db, now()),
    watchUsage(watch),
  ]);
  // The reason only by its kind: a database error can quote the statement.
  if (sessions.status === "rejected") warn("maintenance: couldn't delete expired sessions");
  if (usage.status === "rejected") warn("maintenance: the usage watch failed");
};
