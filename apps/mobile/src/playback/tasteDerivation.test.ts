import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { magicLibrarySongs, tasteProfile, magicQueuePicks } from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import { traceQueries } from "../library/db/testDatabase.ts";
import { buildHomeMagicQueue } from "../home/magicQueueJob.ts";
import { readTasteLibrary, deriveTaste } from "./tasteDerivation.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
test("due Home's real store snapshot is read once and reused for the same full taste as ti", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const convert = magicLibrarySongs(Effect.runSync(store.listArtists));
    const expectedSongs = Effect.runSync(store.listSongs).map(convert);
    const byId = new Map(expectedSongs.map((song) => [song.trackId, song]));
    const expected = tasteProfile(
      Effect.runSync(store.tasteHistory),
      (id) => byId.get(id),
      fixture.now,
    );
    let turns = 0;
    const turn = Effect.sync(() => {
      turns++;
    });
    const { result, queries } = traceQueries(fixture.db, () =>
      Effect.runSync(
        Effect.gen(function* () {
          const library = yield* readTasteLibrary(store, turn);
          const profile = yield* deriveTaste(store, turn, fixture.now, library);
          return { library, profile };
        }),
      ),
    );
    assert.deepEqual(result.profile, expected);
    assert.deepEqual(result.library.magic, expectedSongs);
    const songs = queries.filter((query) => query.sql.includes('"tracks"."title"'));
    assert.ok(songs.length > 1);
    assert.equal(songs.reduce((n, q) => n + q.rows, 0), 1000);
    assert.ok(queries.every((query) => query.rows <= 128));
    assert.ok(queries.every((query) => !/OFFSET/i.test(query.sql)));
    assert.equal(queries.filter((q) => /FROM artists a/.test(q.sql)).reduce((n, q) => n + q.rows, 0), fixture.db.all<{id:number}>(sql`SELECT id FROM artists`).length);
    const picks = Effect.runSync(buildHomeMagicQueue(store, null, {
      now: fixture.now, random: () => 0.5, turn,
      taste: (library) => deriveTaste(store, turn, fixture.now, library),
    }));
    assert.deepEqual(picks, magicQueuePicks(null, expectedSongs.filter((song) => result.library.playable.some((s) => s.trackId === song.trackId)), {now: fixture.now, taste: expected, random: () => 0.5}));
    assert.ok(turns >= 5);
  } finally {
    fixture.close();
  }
});
