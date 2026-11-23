import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/sql-js";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import initSqlJs from "sql.js";
import type { BindParams, Database as SqlJsDatabase } from "sql.js";
import { Database, SqliteDriver, databaseLayer } from "./index.ts";
import { migrateDatabase } from "./database.ts";
import type { LibraryDatabase } from "./db/database.ts";
import migrations from "./db/migrations.ts";
import { openSqlJsDatabase } from "./db/sqlJsDatabase.ts";
import * as schema from "./db/schema.ts";
import { libraryCounts } from "./db/counts.ts";

test("an app-provided SQLite driver opens a fresh Library through the shared layer", async () => {
  const SQL = await initSqlJs();
  const client = new SQL.Database();
  try {
    const driver = Layer.succeed(SqliteDriver, {
      db: drizzle(client, { schema }),
      exec: (statements) => {
        client.exec(statements);
      },
    });
    const counts = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* Database;
        return libraryCounts(db);
      }).pipe(Effect.provide(databaseLayer.pipe(Layer.provide(driver)))),
    );
    assert.deepEqual(counts, {
      playlists: 0,
      artists: 0,
      albums: 0,
      songs: 0,
      genres: 0,
      favorites: 0,
    });
  } finally {
    client.close();
  }
});

const dialect = new SQLiteSyncDialect();

/**
 * The phone's driver (Drizzle over expo-sqlite): `get` steps a new statement once and leaves
 * it there, never reset, and answers `null` when there is no row. sql.js's driver answers
 * `undefined` and frees its statement.
 */
const phoneLikeGet = (client: SqlJsDatabase, db: LibraryDatabase): LibraryDatabase =>
  new Proxy(db, {
    get: (target, property, receiver) =>
      property === "get"
        ? (query: SQL) => {
            const { sql, params } = dialect.sqlToQuery(query);
            const statement = client.prepare(sql, params as BindParams);
            return statement.step() ? statement.getAsObject() : null;
          }
        : Reflect.get(target, property, receiver),
  });

const appliedMigrations = (client: SqlJsDatabase): number =>
  Number(client.exec("SELECT count(*) FROM __drizzle_migrations")[0]!.values[0]![0]);

const through = (tag: string): typeof migrations => {
  const last = migrations.journal.entries.findIndex((entry) => entry.tag === tag);
  return { ...migrations, journal: { entries: migrations.journal.entries.slice(0, last + 1) } };
};

test("a fresh install migrates every bundled migration when the driver answers an empty table with null", async () => {
  const { client, db } = await openSqlJsDatabase();
  try {
    migrateDatabase(phoneLikeGet(client, db));
    assert.equal(appliedMigrations(client), migrations.journal.entries.length);
    assert.equal(libraryCounts(db).songs, 0);
  } finally {
    client.close();
  }
});

test("a fresh install migrates every bundled migration when the driver answers an empty table with undefined", async () => {
  const { client, db } = await openSqlJsDatabase();
  try {
    migrateDatabase(db);
    assert.equal(appliedMigrations(client), migrations.journal.entries.length);
    assert.equal(libraryCounts(db).songs, 0);
  } finally {
    client.close();
  }
});

test("an existing install runs only its pending migrations, one dropping a table among them", async () => {
  const { client, db } = await openSqlJsDatabase();
  try {
    // An install from before 0016, which drops and rebuilds `playlist_items`.
    migrateDatabase(db, through("0015_tag_credits"));
    assert.equal(appliedMigrations(client), 16);
    // Each migration runs once: running one already applied again would fail (its tables exist).
    migrateDatabase(phoneLikeGet(client, db));
    assert.equal(appliedMigrations(client), migrations.journal.entries.length);
    migrateDatabase(phoneLikeGet(client, db));
    assert.equal(appliedMigrations(client), migrations.journal.entries.length);
  } finally {
    client.close();
  }
});
