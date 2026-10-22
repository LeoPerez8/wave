/** #596 characterizes current public work seams; follow-up tickets replace these counts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";

import { createPlaylistReplay } from "../../../bench/fastAgain/playlistReplay.ts";
import { fileURLToPath } from "node:url";
import { loadLibraryStore, loadWorktreeModule } from "../../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { traceQueries } from "./testDatabase.ts";

const CURRENT_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

test("Recap availability re-reads counted history for an unchanged focus result", async () => {
  const fixture = await createFastAgainFixture();
  const now = Date.now;
  try {
    Date.now = () => fixture.now;
    const store = await loadLibraryStore(CURRENT_ROOT, fixture.db);
    const module = await loadWorktreeModule<typeof import("../../stats/Stats.ts")>(
      CURRENT_ROOT,
      "apps/mobile/src/stats/Stats.ts",
    );
    const storeModule = await loadWorktreeModule<typeof import("../LibraryStore.ts")>(
      CURRENT_ROOT,
      "apps/mobile/src/library/LibraryStore.ts",
    );
    const stats = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* module.Stats;
      }).pipe(Effect.provide(module.layer), Effect.provideService(storeModule.LibraryStore, store)),
    );
    const first = traceQueries(fixture.db, () => Effect.runSync(stats.recaps));
    const again = traceQueries(fixture.db, () => Effect.runSync(stats.recaps));
    assert.deepEqual(again.result, first.result);
    assert.ok(first.result.length > 0);
    for (const read of [first, again]) {
      assert.equal(read.queries.length, 1);
      assert.equal(
        read.queries.reduce((sum, query) => sum + query.rows, 0),
        7200,
      );
      assert.ok(read.queries.some((query) => query.plan.some((step) => step.includes("SCAN"))));
    }
  } finally {
    Date.now = now;
    fixture.close();
  }
});

test("retained playlist sessions renew independently for an unrelated burst track change", async () => {
  const fixture = await createFastAgainFixture();
  const replay = await createPlaylistReplay(CURRENT_ROOT, fixture);
  assert.ok(replay);
  try {
    await replay.mount();
    const one = await replay.change(true);
    assert.deepEqual(replay.work, { reads: 1, rowsRead: 2343, statements: 15, notifications: 3 });
    assert.equal(one[0]!.filter((id) => id !== null).length, 5);
    await replay.mount();
    const two = await replay.change(true);
    assert.deepEqual(replay.work, { reads: 2, rowsRead: 4686, statements: 30, notifications: 6 });
    assert.deepEqual(two, [one[0], one[0]]);
    replay.close();
    await replay.change(true);
    assert.deepEqual(replay.work, { reads: 0, rowsRead: 0, statements: 0, notifications: 0 });
  } finally {
    replay.close();
    fixture.close();
  }
});

test("two requested artist rows materialize global credits; a scoped probe preserves counts", async () => {
  const { scopedArtistProbe } = await import("../../../bench/fastAgain/boundedReadProbes.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(CURRENT_ROOT, fixture.db);
    const ids = [fixture.targets.small.artistId, fixture.targets.large.artistId];
    const global = traceQueries(fixture.db, () => Effect.runSync(store.artistsByIds(ids)));
    const scoped = traceQueries(fixture.db, () => scopedArtistProbe(fixture.db, ids));
    assert.deepEqual(scoped.result, global.result);
    assert.deepEqual(
      global.result.map((row) => row.trackCount).toSorted((a, b) => a - b),
      [20, 300],
    );
    assert.equal(
      global.queries.reduce((sum, query) => sum + query.rows, 0),
      2,
    );
    assert.ok(global.queries[0]!.plan.some((step) => /SCAN track_artists/.test(step)));
    assert.ok(scoped.queries[0]!.plan.some((step) => /SEARCH track_artists/.test(step)));
    assert.ok(!scoped.queries[0]!.plan.some((step) => /SCAN track_artists/.test(step)));
  } finally {
    fixture.close();
  }
});

test("a genre opening decodes every genre song; a bounded projection preserves the first page", async () => {
  const { eq } = await import("drizzle-orm");
  const { trackQuery, BY_TITLE } = await import("./tracks.ts");
  const schema = await import("./schema.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(CURRENT_ROOT, fixture.db);
    const full = traceQueries(fixture.db, () => Effect.runSync(store.getGenre(fixture.genreId)));
    const page = traceQueries(fixture.db, () =>
      trackQuery(fixture.db)
        .where(eq(schema.tracks.genreId, fixture.genreId))
        .orderBy(...BY_TITLE)
        .limit(50)
        .all(),
    );
    assert.equal(full.result!.songs.length, 334);
    assert.equal(
      full.queries.reduce((sum, query) => sum + query.rows, 0),
      335,
    );
    assert.equal(
      page.queries.reduce((sum, query) => sum + query.rows, 0),
      50,
    );
    assert.deepEqual(page.result, full.result!.songs.slice(0, 50));
  } finally {
    fixture.close();
  }
});

test("the shared Artist graph puts all history and Library rows between the same two yields", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(CURRENT_ROOT, fixture.db);
    const { readArtistGraph } = await loadWorktreeModule<
      typeof import("../../home/artistGraph.ts")
    >(CURRENT_ROOT, "apps/mobile/src/home/artistGraph.ts");
    let segment = 0;
    const rows = [0, 0, 0];
    const reads = { ...store } as { -readonly [K in keyof typeof store]: (typeof store)[K] };
    for (const name of [
      "candidateCatalog",
      "ytArtistSimilar",
      "tasteHistory",
      "listSongs",
      "listArtists",
    ] as const) {
      reads[name] = Effect.sync(() => {
        const traced = traceQueries(fixture.db, () =>
          Effect.runSync(store[name] as Effect.Effect<unknown, unknown>),
        );
        rows[segment]! += traced.queries.reduce((sum, query) => sum + query.rows, 0);
        return traced.result;
      }) as never;
    }
    const between = Effect.sync(() => {
      segment++;
    });
    const actual = Effect.runSync(readArtistGraph(reads, between));
    assert.deepEqual(actual, Effect.runSync(readArtistGraph(store)));
    assert.equal(segment, 2);
    assert.deepEqual(rows, [0, 11190, 0]);
  } finally {
    fixture.close();
  }
});
