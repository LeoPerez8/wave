import { sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { configureConnection } from "./db/connection.ts";
import type { LibraryDatabase } from "./db/database.ts";
import migrations from "./db/migrations.ts";
import type { ReadConnection } from "./db/offThreadReads.ts";

export type { LibraryDatabase, RowPage } from "./db/database.ts";

/**
 * Each app owns its connection's lifetime and supplies its synchronous Drizzle driver,
 * and, where reads can leave the JS thread, the read connections they use (#1348).
 */
export class SqliteDriver extends Context.Service<
  SqliteDriver,
  {
    readonly db: LibraryDatabase;
    readonly exec: (statements: string) => void;
    readonly reads?: ReadConnection;
  }
>()("@wave/client/SqliteDriver") {}

export class Database extends Context.Service<Database, LibraryDatabase>()(
  "@wave/client/Database",
) {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown;
}> {}

/**
 * Drizzle's SQLite migration protocol, using only its public database operations.
 * The journal timestamps, empty hashes and table match the shipped Expo migrator,
 * so an existing wave.db keeps its migration history when changing drivers.
 */
export const migrateDatabase = (db: LibraryDatabase, bundle = migrations): void => {
  const pending = bundle.journal.entries.map((entry) => {
    const text =
      bundle.migrations[`m${String(entry.idx).padStart(4, "0")}` as keyof typeof bundle.migrations];
    if (text === undefined) throw new Error(`Missing migration: ${entry.tag}`);
    return { when: entry.when, statements: text.split("--> statement-breakpoint") };
  });
  db.run(sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
  const last = db.get<{ created_at: number }>(
    sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
  );
  db.transaction((tx) => {
    for (const migration of pending) {
      if (last !== undefined && Number(last.created_at) >= migration.when) continue;
      for (const statement of migration.statements) tx.run(sql.raw(statement));
      tx.run(
        sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', ${migration.when})`,
      );
    }
  });
};

/** Configures and migrates once when an app builds its service graph. */
export const databaseLayer = Layer.effect(
  Database,
  Effect.gen(function* () {
    const driver = yield* SqliteDriver;
    return yield* Effect.try({
      try: () => {
        configureConnection(driver.exec);
        migrateDatabase(driver.db);
        return driver.db;
      },
      catch: (cause) => new DatabaseError({ cause }),
    });
  }),
);
