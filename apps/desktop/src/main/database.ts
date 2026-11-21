/** The desktop's Library: one better-sqlite3 file, opened through @wave/client. */
import { DatabaseError, SqliteDriver, databaseLayer } from "@wave/client";
import * as schema from "@wave/client/db/schema";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createFindMatcher, scanPathKey, sortKey } from "@wave/core";

/**
 * SQLite's `wave_finds(query, title, artist, album)`: 1 when a list's Find [query] finds the row
 * (Core's `createFindMatcher`). The last query's matcher is kept: a page reads many rows.
 */
const findsRows = () => {
  let last: { query: string; finds: ReturnType<typeof createFindMatcher> } | undefined;
  return (query: unknown, title: unknown, artist: unknown, album: unknown) => {
    const text = String(query ?? "");
    if (last?.query !== text) last = { query: text, finds: createFindMatcher(text) };
    const name = (value: unknown) => (value === null || value === undefined ? "" : String(value));
    return last.finds === null ||
      last.finds({ title: name(title), artist: name(artist), album: name(album) })
      ? 1
      : 0;
  };
};

/** The connection to `file`, closed when the layer's scope closes. */
export const sqliteDriverLayer = (file: string) =>
  Layer.effect(
    SqliteDriver,
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          const client = new BetterSqlite3(file);
          client.function("wave_sort_key", { deterministic: true }, (value) =>
            sortKey(String(value)),
          );
          client.function("wave_finds", { deterministic: true }, findsRows());
          client.function("wave_scan_path_key", { deterministic: true }, (path) =>
            typeof path === "string" ? scanPathKey(path, process.platform) : null,
          );
          client.exec(
            "CREATE TABLE IF NOT EXISTS desktop_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
          );
          // The account's synced settings (`desktopSync.ts`), kept apart from the desktop's own.
          client.exec(
            "CREATE TABLE IF NOT EXISTS desktop_synced_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
          );
          return drizzle({ client, schema });
        },
        catch: (cause) => new DatabaseError({ cause }),
      }),
      (db) => Effect.sync(() => db.$client.close()),
    ).pipe(
      Effect.map((db) => ({ db, exec: (statements: string) => void db.$client.exec(statements) })),
    ),
  );

/** The migrated Library in `file`, ready for the services. */
export const libraryLayer = (file: string) =>
  databaseLayer.pipe(Layer.provide(sqliteDriverLayer(file)));
