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

test("shared Recap availability reads bounded pages once and no SQL on unchanged Home/Now Playing returns", async () => {
  const { createRecapReplay } = await import("../../../bench/fastAgain/recapReplay.ts");
  const fixture = await createFastAgainFixture();
  const replay = await createRecapReplay(CURRENT_ROOT, fixture);
  assert.ok(replay);
  try {
    replay.reset(true);
    const home = replay.attach(false);
    const peer = replay.attach(false);
    await replay.drain();
    assert.equal(replay.work.statements, 0);
    home.setActive(true);
    peer.setActive(true);
    await replay.drain();
    assert.ok(replay.get()!.length > 0);
    assert.equal(replay.work.reads, 1);
    assert.equal(replay.work.statements, Math.ceil(fixture.playEvents / 512));
    assert.ok(
      replay.work.rowsRead < 7300,
      "only quarter sums and bounded page cursors cross the SQL boundary",
    );
    assert.ok(replay.work.maxRows <= 513);
    assert.equal(replay.work.notifications, 2);
    const first = replay.get();
    replay.reset(true);
    for (let i = 0; i < 3; i++) {
      home.setActive(false);
      peer.setActive(false);
      home.setActive(true);
      peer.setActive(true);
      await replay.drain();
    }
    assert.equal(replay.get(), first);
    assert.deepEqual(replay.work, {
      reads: 0,
      rowsRead: 0,
      statements: 0,
      notifications: 0,
      maxRows: 0,
    });
    home.setActive(false);
    peer.setActive(false);
    for (let i = 0; i < 3; i++)
      Effect.runSync(
        replay.store.saveImportedPlays([
          { trackId: fixture.songIds[0]!, startedAt: fixture.now - i },
        ]),
      );
    await replay.drain();
    assert.equal(replay.work.reads, 0);
    home.setActive(true);
    peer.setActive(true);
    await replay.drain();
    assert.equal(replay.work.reads, 1);
    assert.equal(replay.work.notifications, 0, "unchanged periods keep their snapshot");
  } finally {
    replay.close();
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

test("two requested artist rows seek only their indexed credits with complete metadata preserved", async () => {
  const { selectArtistsBefore600 } =
    await import("../../../bench/fastAgain/artistCountReference.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(CURRENT_ROOT, fixture.db);
    const ids = [fixture.targets.small.artistId, fixture.targets.large.artistId];
    const scoped = traceQueries(fixture.db, () => Effect.runSync(store.artistsByIds(ids)));
    assert.deepEqual(scoped.result, selectArtistsBefore600(fixture.db, { ids }));
    assert.deepEqual(
      scoped.result.map((row) => row.trackCount).toSorted((a, b) => a - b),
      [20, 300],
    );
    assert.equal(
      scoped.queries.reduce((sum, query) => sum + query.rows, 0),
      2,
    );
    assert.ok(
      scoped.queries[0]!.plan.some((step) =>
        /SEARCH track_artists.*track_artists_artist_idx/.test(step),
      ),
    );
    assert.ok(!scoped.queries[0]!.plan.some((step) => /SCAN track_artists/.test(step)));
  } finally {
    fixture.close();
  }
});

test("a genre opening replaces full hydration with a header and 50 indexed summaries", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(CURRENT_ROOT, fixture.db);
    const opening = traceQueries(fixture.db, () =>
      Effect.runSync(store.openGenre(fixture.genreId, { key: "title", descending: false })),
    );
    assert.equal(opening.result!.genre.trackCount, 334);
    assert.equal(opening.result!.songs.length, 50);
    assert.equal(
      opening.queries.reduce((sum, query) => sum + query.rows, 0),
      51,
    );
    assert.ok(
      opening.queries
        .flatMap((query) => query.plan)
        .some((step) => /SEARCH o USING (COVERING )?INDEX genre_order_title_asc/.test(step)),
    );
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
