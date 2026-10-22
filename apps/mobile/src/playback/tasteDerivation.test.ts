import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { magicLibrarySongs, tasteProfile } from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import { traceQueries } from "../library/db/testDatabase.ts";
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
    assert.equal(songs.length, 1);
    assert.equal(songs[0]!.rows, 1000);
    assert.ok(turns >= 5);
  } finally {
    fixture.close();
  }
});
