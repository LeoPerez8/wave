import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";

import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("desktop adapter runs the actual LibraryStore effects against the shared SQLite fixture", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    assert.equal(Effect.runSync(store.countTracks), 1000);
    assert.equal(Effect.runSync(store.listSongs).length, 1000);
    assert.equal(
      Effect.runSync(store.getArtist(fixture.targets.large.artistId))?.songs.length,
      300,
    );
    assert.equal(Effect.runSync(store.getAlbum(fixture.albumId))?.tracks.length, 10);
    assert.equal(Effect.runSync(store.tasteHistory).plays.length, 10000);
    assert.equal(Effect.runSync(store.measureScale).playEvents, 10000);
  } finally {
    fixture.close();
  }
});

test("libraryReads inventories broad recommendation reads as well as targeted reads", async () => {
  const { bench } = await import("../../bench/fastAgain/benches/libraryReads.ts");
  const { runBenchmarks } = await import("../../bench/fastAgain/runner.ts");
  const rows: Record<string, unknown>[] = [];
  await runBenchmarks({
    sizes: [1000],
    runs: 1,
    variants: [{ variant: "after", root }],
    benches: [bench],
    emit: (line) => rows.push(line),
  });
  const measurements = rows.filter((line) => line.kind === "measurement");
  assert.equal(measurements.find((m) => m.read === "listSongs")?.rowsRead, 1000);
  assert.ok(
    Number(measurements.find((m) => m.read === "playlistRecommendationInput")?.rowsRead) > 1000,
  );
  assert.equal(measurements.find((m) => m.read === "trackDetails")?.rowsRead, 1);
  const ranking = rows.find((line) => line.kind === "slowest");
  assert.ok(ranking);
  assert.ok(Array.isArray(ranking.reads));
  assert.equal(ranking.reads.length, 20);
});
