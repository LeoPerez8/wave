/**
 * How the Library's connection is set up, on the phone (expo-sqlite) and in
 * tests (sql.js), and when SQLite refreshes the statistics its planner reads.
 */
import { sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";

/**
 * Settings for one long-lived connection on a phone: WAL with a NORMAL sync
 * (a commit no longer waits on a full disk sync; WAL keeps the database
 * consistent, and only the last commits before a power loss can be lost),
 * temporary tables and sorts in memory, an 8 MiB page cache (SQLite's default
 * is 2 MiB), 64 MiB of memory-mapped reads, and ANALYZE sampling at most 400
 * rows per index so `optimizeDatabase` stays cheap on a large history.
 */
const SETTINGS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA foreign_keys = ON",
  "PRAGMA temp_store = MEMORY",
  "PRAGMA cache_size = -8192",
  "PRAGMA mmap_size = 67108864",
  "PRAGMA analysis_limit = 400",
]
  .map((statement) => `${statement};`)
  .join(" ");

/** Applies the connection's settings through the driver's multi-statement [exec]. */
export const configureConnection = (exec: (statements: string) => void): void => {
  exec(SETTINGS);
};

/**
 * Lets SQLite refresh its planner statistics where they're missing or stale:
 * once the connection is `opened` (and migrated), over every table, and when
 * `leaving` the app (it goes to the background), over the tables this
 * session's reads used. Each run analyses only what changed enough.
 */
export const optimizeDatabase = (db: LibraryDatabase, when: "opened" | "leaving"): void => {
  db.run(sql.raw(when === "opened" ? "PRAGMA optimize = 0x10002" : "PRAGMA optimize"));
};
