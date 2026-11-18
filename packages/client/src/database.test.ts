import assert from "node:assert/strict";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/sql-js";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import initSqlJs from "sql.js";
import { Database, SqliteDriver, databaseLayer } from "./index.ts";
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
