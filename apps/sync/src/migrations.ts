/**
 * The database's schema, as ordered migrations. `migrate` runs those not run
 * yet; `pnpm --filter @wave/sync deploy` runs it before `wrangler deploy`,
 * and the tests run it on a fresh database. A migration, once deployed, never
 * changes: a schema change is a new one at the end.
 */

import type { Client } from "@libsql/client";

export interface Migration {
  readonly id: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_accounts_and_sessions",
    statements: [
      `CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        google_sub TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        change_seq INTEGER NOT NULL DEFAULT 0
      )`,
      // The token is never stored, only its SHA-256 (hex).
      `CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        window_start INTEGER NOT NULL DEFAULT 0,
        window_count INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX sessions_account_idx ON sessions (account_id)`,
    ],
  },
  {
    // Every row: the account, its id and the account's change number when it last changed.
    // Rows that can be removed also have Core's SyncRow fields; a tombstone's own fields are null.
    id: "0002_synced_rows",
    statements: [
      `CREATE TABLE songs (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        change_no INTEGER NOT NULL,
        changed_at INTEGER NOT NULL,
        phone_id TEXT NOT NULL,
        deleted INTEGER NOT NULL,
        title TEXT,
        credit TEXT,
        album TEXT,
        album_artist TEXT,
        disc_number INTEGER,
        track_number INTEGER,
        duration_ms INTEGER,
        year INTEGER,
        genre TEXT,
        video_id TEXT,
        added_at INTEGER,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE INDEX songs_change_idx ON songs (account_id, change_no)`,
      `CREATE TABLE playlists (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        change_no INTEGER NOT NULL,
        changed_at INTEGER NOT NULL,
        phone_id TEXT NOT NULL,
        deleted INTEGER NOT NULL,
        name TEXT,
        created_at INTEGER,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE INDEX playlists_change_idx ON playlists (account_id, change_no)`,
      `CREATE TABLE playlist_entries (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        change_no INTEGER NOT NULL,
        changed_at INTEGER NOT NULL,
        phone_id TEXT NOT NULL,
        deleted INTEGER NOT NULL,
        playlist_id TEXT,
        order_key TEXT,
        song_id TEXT,
        yt_song TEXT,
        added_at INTEGER,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE INDEX playlist_entries_change_idx ON playlist_entries (account_id, change_no)`,
      `CREATE TABLE favorites (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        change_no INTEGER NOT NULL,
        changed_at INTEGER NOT NULL,
        phone_id TEXT NOT NULL,
        deleted INTEGER NOT NULL,
        added_at INTEGER,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE INDEX favorites_change_idx ON favorites (account_id, change_no)`,
      `CREATE TABLE preferences (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        change_no INTEGER NOT NULL,
        changed_at INTEGER NOT NULL,
        phone_id TEXT NOT NULL,
        deleted INTEGER NOT NULL,
        value TEXT,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE INDEX preferences_change_idx ON preferences (account_id, change_no)`,
      `CREATE TABLE plays (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        change_no INTEGER NOT NULL,
        song_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        listened_ms INTEGER NOT NULL,
        duration_ms INTEGER,
        end_reason TEXT NOT NULL,
        counted INTEGER NOT NULL,
        context_type TEXT,
        context_id TEXT,
        source TEXT NOT NULL,
        imported_from TEXT,
        PRIMARY KEY (account_id, id)
      )`,
      `CREATE INDEX plays_change_idx ON plays (account_id, change_no)`,
    ],
  },
];

/** Runs the migrations [db] hasn't run yet, each in its own transaction. Gives the ids it ran. */
export const migrate = async (db: Client): Promise<string[]> => {
  await db.execute(
    "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const done = new Set((await db.execute("SELECT id FROM migrations")).rows.map((row) => row.id));
  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    await db.batch(
      [
        ...migration.statements,
        { sql: "INSERT INTO migrations (id, applied_at) VALUES (?, ?)", args: [migration.id, Date.now()] },
      ],
      "write",
    );
    ran.push(migration.id);
  }
  return ran;
};
