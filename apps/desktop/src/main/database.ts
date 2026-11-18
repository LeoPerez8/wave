/** The desktop's Library: one better-sqlite3 file, opened through @wave/client. */
import { DatabaseError, SqliteDriver, databaseLayer } from "@wave/client";
import * as schema from "@wave/client/db/schema";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** The connection to `file`, closed when the layer's scope closes. */
export const sqliteDriverLayer = (file: string) =>
  Layer.effect(
    SqliteDriver,
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          const client = new BetterSqlite3(file);
          client.exec(
            "CREATE TABLE IF NOT EXISTS desktop_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
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
