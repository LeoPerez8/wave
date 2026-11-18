import assert from "node:assert/strict";
import { test } from "node:test";
import { Database, SqliteDriver, databaseLayer } from "@wave/client";
import migrations from "@wave/client/db/migrations";
import * as schema from "@wave/client/db/schema";
import { libraryCounts } from "@wave/client/db/counts";
import { selectSongsWithIds } from "@wave/client/db/songOrder";
import { setFavorites, listFavorites } from "@wave/client/db/playHistory";
import { createPlaylist, selectPlaylists } from "@wave/client/db/playlists";
import { addTrack } from "@wave/client/testing";
import { drizzle } from "drizzle-orm/sql-js";
import { migrate as expoMigrate } from "drizzle-orm/expo-sqlite/migrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import initSqlJs from "sql.js";

test("the current release's Expo migration journal upgrades and reopens without losing the Library", async () => {
  const SQL = await initSqlJs();
  const old = new SQL.Database();
  const release = drizzle(old, { schema });
  // Run the actual shipped migrator, rather than building a journal with the new code.
  await expoMigrate(release as unknown as Parameters<typeof expoMigrate>[0], migrations);
  const song = addTrack(release, { title: "Airbag", artist: "Radiohead", album: "OK Computer" });
  setFavorites(release, [song], true, 10);
  createPlaylist(release, "Drive", [{ source: "library", trackId: song }], 20);
  const image = old.export();
  old.close();
  const client = new SQL.Database(image);
  try {
    const driver = Layer.succeed(SqliteDriver, {
      db: drizzle(client, { schema }),
      exec: (statements) => {
        client.exec(statements);
      },
    });
    const read = Effect.gen(function* () {
      const db = yield* Database;
      return {
        counts: libraryCounts(db),
        songs: selectSongsWithIds(db, [song]).map((row) => row.title),
        favorites: listFavorites(db).map((row) => row.id),
        playlists: selectPlaylists(db).map((row) => row.name),
      };
    }).pipe(Effect.provide(databaseLayer.pipe(Layer.provide(driver))));
    const expected = {
      counts: { playlists: 1, artists: 1, albums: 1, songs: 1, genres: 0, favorites: 1 },
      songs: ["Airbag"],
      favorites: [song],
      playlists: ["Drive"],
    };
    assert.deepEqual(await Effect.runPromise(read), expected);
    assert.deepEqual(await Effect.runPromise(read), expected);
  } finally {
    client.close();
  }
});
