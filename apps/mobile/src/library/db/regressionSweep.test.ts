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

test("one/two retained hidden playlists do no recommendation work and catch up once after settlement", async () => {
  const fixture = await createFastAgainFixture();
  const replay = await createPlaylistReplay(CURRENT_ROOT, fixture);
  assert.ok(replay);
  try {
    for (const mounted of [1, 2]) {
      replay.begin();
      await replay.mount({ settled: false });
      await replay.end();
      assert.deepEqual(replay.work, {
        reads: 0,
        ranks: 0,
        rowsRead: 0,
        statements: 0,
        notifications: 0,
      });
      for (let i = 0; i < mounted; i++) replay.show(i, false);
      replay.begin();
      for (let i = 0; i < 12; i++) {
        replay.publish("tracks");
        replay.publish("favorites");
      }
      await replay.end();
      assert.deepEqual(replay.work, {
        reads: 0,
        ranks: 0,
        rowsRead: 0,
        statements: 0,
        notifications: 0,
      });
    }
    replay.begin();
    replay.show(0, true);
    await replay.end();
    assert.equal(replay.work.reads, 0, "still unsettled on return");
    replay.begin();
    replay.settle();
    await replay.end();
    assert.deepEqual([replay.work.reads, replay.work.ranks, replay.work.notifications], [1, 1, 3]);
    assert.equal(replay.sessions[0]!.get().slots.filter((x) => x !== null).length, 5);
    assert.ok(Math.max(...replay.taskRows) <= 256);
    replay.begin();
    replay.show(1, true);
    await replay.end();
    assert.deepEqual([replay.work.reads, replay.work.ranks, replay.work.notifications], [1, 1, 3]);
    assert.equal(
      replay.work.rowsRead,
      52,
      "second visit shares the source, reading only its membership and existence checks",
    );
    const offered = replay.identities();
    assert.deepEqual(offered[0], offered[1]);
    replay.begin();
    for (let i = 0; i < 12; i++) replay.publish("tracks");
    await replay.end();
    assert.deepEqual([replay.work.reads, replay.work.ranks, replay.work.notifications], [2, 2, 6]);
    assert.ok(replay.work.rowsRead < 5000, "one shared source version, not two");
    replay.begin();
    replay.publish("playlists", [fixture.playlistId + 1]);
    await replay.end();
    assert.deepEqual(replay.work, {
      reads: 0,
      ranks: 0,
      rowsRead: 0,
      statements: 0,
      notifications: 0,
    });
    replay.close();
    replay.begin();
    replay.publish("tracks");
    await replay.end();
    assert.deepEqual(replay.work, {
      reads: 0,
      ranks: 0,
      rowsRead: 0,
      statements: 0,
      notifications: 0,
    });
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

test("the shared Artist graph bounds every graph input segment instead of materializing history/Library", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(CURRENT_ROOT, fixture.db);
    const { readArtistGraph } = await loadWorktreeModule<
      typeof import("../../home/artistGraph.ts")
    >(CURRENT_ROOT, "apps/mobile/src/home/artistGraph.ts");
    let yields = 0;
    const traced = traceQueries(fixture.db, () =>
      Effect.runSync(
        readArtistGraph(
          store,
          Effect.sync(() => {
            yields++;
          }),
        ),
      ),
    );
    assert.deepEqual(traced.result, Effect.runSync(readArtistGraph(store)));
    assert.ok(yields > 100);
    assert.ok(traced.queries.every((query) => query.rows <= 128));
    assert.ok(traced.queries.every((query) => !/OFFSET/.test(query.sql)));
    assert.equal(
      traced.queries.reduce((sum, query) => sum + query.rows, 0),
      fixture.playEvents,
    );
  } finally {
    fixture.close();
  }
});

test("a real paged read overtaken by a playlist edit cannot republish the added offer", async () => {
  const { addToPlaylist } = await import("./playlists.ts");
  const fixture = await createFastAgainFixture();
  const replay = await createPlaylistReplay(CURRENT_ROOT, fixture);
  assert.ok(replay);
  try {
    const session = await replay.mount();
    const held = session.get().slots[0]!;
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const read = replay.store.recommendationEntriesPage;
    let block = true;
    replay.store.recommendationEntriesPage = (id, after) =>
      Effect.gen(function* () {
        const rows = yield* read(id, after);
        if (block) {
          block = false;
          entered.resolve();
          yield* Effect.promise(() => release.promise);
        }
        return rows;
      });
    replay.publish("favorites", undefined, false);
    await entered.promise;
    addToPlaylist(
      fixture.db,
      fixture.playlistId,
      [{ source: "library", trackId: Number(held.track.id) }],
      fixture.now,
    );
    replay.publish("playlists", [fixture.playlistId], false);
    release.resolve();
    await replay.drain();
    assert.equal(
      session.get().slots.some((offer) => offer?.track.id === held.track.id),
      false,
    );
    assert.equal(session.get().loading, false);
    assert.equal(session.get().error, null);
    const offer = session.get().slots[0]!;
    assert.deepEqual(await Promise.all([session.dismiss(offer.key), session.dismiss(offer.key)]), [
      true,
      false,
    ]);
    assert.equal(
      session.get().slots.some((x) => x?.track.id === offer.track.id),
      false,
    );
    const feedback = Effect.runSync(
      replay.store.playlistRecommendationInput(fixture.playlistId),
    ).feedback;
    assert.equal(feedback.filter((signal) => signal.track.id === offer.track.id).length, 1);
  } finally {
    replay.close();
    fixture.close();
  }
});
