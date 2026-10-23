import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";
import { createFastAgainFixture } from "./db/fastAgainFixture.ts";
import { traceQueries } from "./db/testDatabase.ts";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { sharePlaylistRecommendationInputs } from "./playlistRecommendationInputs.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
test("paged recommendation input equals historical input and shares one bounded source snapshot", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const expected = Effect.runSync(store.playlistRecommendationInput(fixture.playlistId));
    let turns = 0;
    let maxRows = 0;
    let rows = 0;
    let totalRows = 0;
    const between = Effect.sync(() => {
      turns++;
      maxRows = Math.max(maxRows, rows);
      rows = 0;
    });
    const wrapped = { ...store };
    for (const name of [
      "mixSongsPage",
      "mixArtistsPage",
      "mixCatalogPage",
      "graphRadioPage",
      "recommendationFlagsPage",
      "recommendationPendingPage",
      "recommendationEntriesPage",
      "recommendationFeedbackPage",
    ] as const) {
      const read = store[name] as unknown as (...args: never[]) => Effect.Effect<unknown, unknown>;
      wrapped[name] = ((...args: never[]) =>
        Effect.sync(() => {
          const traced = traceQueries(fixture.db, () => Effect.runSync(read(...args)));
          const count = traced.queries.reduce((sum, q) => sum + q.rows, 0);
          rows += count;
          totalRows += count;
          return traced.result;
        })) as never;
    }
    const source = sharePlaylistRecommendationInputs(wrapped, between);
    const input = await Effect.runPromise(source.get(fixture.playlistId));
    const { songById, ...historical } = input;
    assert.deepEqual(historical, expected);
    assert.equal(songById.size, 1000);
    assert.ok(turns > 20);
    assert.ok(maxRows <= 256, `SQL rows per turn: ${maxRows}`);
    const before = totalRows;
    await Effect.runPromise(source.get(fixture.playlistId));
    assert.ok(totalRows - before < 60, "warm reads only scoped membership/feedback");
    source.dispose();
  } finally {
    fixture.close();
  }
});

test("source versions invalidate, evict by age, share in-flight reads and never retain invalidated answers", async () => {
  const { setFavorites } = await import("./db/playHistory.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let clock = 0,
      pages = 0;
    const counted = {
      ...store,
      mixSongsPage: (after: number) => {
        pages++;
        return store.mixSongsPage(after);
      },
    };
    const source = sharePlaylistRecommendationInputs(counted, Effect.void, () => clock);
    const [one, two] = await Promise.all([
      Effect.runPromise(source.get(fixture.playlistId)),
      Effect.runPromise(source.get(fixture.playlistId)),
    ]);
    assert.equal(one.library, two.library);
    assert.equal(pages, 9, "one 1000-song snapshot including the final empty page");
    const id = fixture.songIds.at(-1)!;
    const oldStar = one.library.find((track) => track.id === String(id))!.favorite;
    setFavorites(fixture.db, [id], !oldStar, 1);
    source.forget();
    const changed = await Effect.runPromise(source.get(fixture.playlistId));
    assert.notEqual(changed.library, one.library);
    assert.equal(changed.library.find((track) => track.id === String(id))!.favorite, !oldStar);
    assert.equal(pages, 18);
    clock = 60_001;
    await Effect.runPromise(source.get(fixture.playlistId));
    assert.equal(pages, 27, "only the current snapshot is retained; TTL evicts the old one");
    source.dispose();
    await assert.rejects(Effect.runPromise(source.get(fixture.playlistId)));

    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let first = true;
    const interrupted = sharePlaylistRecommendationInputs(
      store,
      Effect.promise(async () => {
        if (first) {
          first = false;
          entered.resolve();
          await release.promise;
        }
      }),
    );
    const old = Effect.runPromise(interrupted.get(fixture.playlistId));
    await entered.promise;
    interrupted.forget();
    release.resolve();
    // The waiter of the forgotten snapshot gets the one read after the forget.
    const reread = await old;
    const current = await Effect.runPromise(interrupted.get(fixture.playlistId));
    assert.equal(reread.library, current.library);
    assert.equal(current.library.find((track) => track.id === String(id))!.favorite, !oldStar);
    interrupted.dispose();
  } finally {
    fixture.close();
  }
});

test("a Dismiss whose refill is reading when a tracks, favorites or catalog change lands still refills", async () => {
  const { playlistRecommendationSession } = await import("@wave/core");
  let clock = 0,
    snapshots = 0;
  const page = () => Effect.promise(() => new Promise<never[]>((r) => setTimeout(() => r([]), 5)));
  const empty = () => Effect.succeed({ rows: [], next: null });
  const store = {
    mixArtistsPage: () => {
      snapshots++;
      return page();
    },
    recommendationFlagsPage: page,
    mixSongsPage: page,
    recommendationPendingPage: page,
    mixCatalogPage: empty,
    graphRadioPage: empty,
    recommendationEntriesPage: () => Effect.succeed([]),
    recommendationFeedbackPage: () => Effect.succeed([]),
  } as unknown as Parameters<typeof sharePlaylistRecommendationInputs>[0];
  const source = sharePlaylistRecommendationInputs(store, Effect.void, () => clock);
  const track = (id: string) => ({
    id,
    source: "stream" as const,
    videoId: id,
    title: id,
    artists: ["a"],
    album: null,
    albumId: null,
    durationMs: 1,
    artworkUrl: null,
    explicit: false,
    genre: null,
    available: true,
  });
  let n = 0;
  const session = playlistRecommendationSession({
    newId: () => `k${++n}`,
    read: (signal) =>
      Effect.runPromise(
        source
          .get(1)
          .pipe(
            Effect.map((input) => ({ playlist: [], sources: { ...input, graph: null, now: 0 } })),
          ),
        { signal },
      ),
    rank: async (input) =>
      ["a", "b", "c", "d", "e", "f"]
        .filter((id) => !input.sources.exclude.some((x) => x.id === id))
        .map((id) => ({ track: track(id) })),
    dismiss: async () => {},
  });
  await session.renew();
  const before = session.get();
  clock = 61_000; // the snapshot aged out while the owner looked at the offers
  const acting = session.dismiss(before.slots[0]!.key);
  await new Promise((r) => setTimeout(r, 7)); // the refill's snapshot is being read
  source.forget(); // observePlaylistRecommendationInputs on a tracks/favorites/catalog change
  await acting;
  const after = session.get();
  assert.equal(after.error, null);
  assert.notEqual(after.slots[0], null);
  assert.notEqual(after.slots[0]!.key, before.slots[0]!.key);
  assert.equal(snapshots, 3, "the first visit, the forgotten refill read, and its re-read");
  source.dispose();
});

test("paged input preserves stream/missing membership, multi-genres and playlist feedback order", async () => {
  const { openTestDatabase, addTrack } = await import("./db/testDatabase.ts");
  const { createPlaylist, addToPlaylist } = await import("./db/playlists.ts");
  const { addCandidates } = await import("./db/candidateCatalog.ts");
  const { dismissPlaylistRecommendation, selectPlaylistRecommendationInput } =
    await import("./db/playlistRecommendations.ts");
  const { eq, sql } = await import("drizzle-orm");
  const schema = await import("./db/schema.ts");
  const { playlistRecommendations } = await import("@wave/core");
  const db = await openTestDatabase();
  const seed = addTrack(db, { title: "Seed", artist: "Radiohead", genre: "Rock" });
  const missing = addTrack(db, { title: "Missing", artist: "Radiohead", genre: "Rock" });
  const local = addTrack(db, { title: "Download", artist: "Radiohead", genre: "Rock" });
  db.update(schema.tracks).set({ path: null }).where(eq(schema.tracks.id, missing)).run();
  db.update(schema.tracks)
    .set({ genres: JSON.stringify(["Rock", "Pop"]), videoId: "local-video" })
    .where(eq(schema.tracks.id, local))
    .run();
  const song = {
    videoId: "stream",
    title: "Stream",
    artists: ["Radiohead"],
    album: null,
    albumId: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  };
  const id = createPlaylist(
    db,
    "One",
    [
      { source: "library", trackId: seed },
      { source: "library", trackId: missing },
      { source: "stream", song },
    ],
    1,
  ).playlistId;
  const other = createPlaylist(db, "Two", [{ source: "library", trackId: seed }], 1).playlistId;
  addCandidates(
    db,
    {
      seed: "Radiohead",
      songs: [
        { ...song, videoId: "local-video", title: "Edited download" },
        { ...song, videoId: "new", title: "New" },
      ],
    },
    1,
  );
  const initial = selectPlaylistRecommendationInput(db, id);
  for (const key of ["z-last", "a-first"])
    dismissPlaylistRecommendation(
      db,
      id,
      { key, track: initial.library.find((track) => track.id === String(local))! },
      1,
    );
  // An unreadable streamed entry is skipped, but must not end the raw cursor walk.
  addToPlaylist(db, id, [{ source: "stream", song: { ...song, videoId: "broken" } }], 2);
  db.run(
    sql`UPDATE playlist_items SET yt_song = 'broken JSON' WHERE playlist_id = ${id} AND yt_song LIKE '%broken%'`,
  );
  const store = await loadLibraryStore(root, db);
  const source = sharePlaylistRecommendationInputs(store, Effect.void);
  const input = await Effect.runPromise(source.get(id));
  const { songById: _rows, ...plain } = input;
  const historical = selectPlaylistRecommendationInput(db, id);
  assert.deepEqual(plain, historical);
  for (const online of [true, false])
    assert.deepEqual(
      playlistRecommendations(input.playlist, { ...input, graph: null, now: 0, online }),
      playlistRecommendations(historical.playlist, { ...historical, graph: null, now: 0, online }),
    );
  const second = await Effect.runPromise(source.get(other));
  assert.equal(second.library, input.library);
  assert.deepEqual(second.feedback, []);
  assert.equal(second.playlist.length, 1);
  source.dispose();
});

test("recommendation pages use indexed seeks at nonzero cursors and stay bounded", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const entries = Effect.runSync(store.recommendationEntriesPage(fixture.playlistId, null));
    const cursor = entries[9]!;
    for (const read of [
      store.recommendationFlagsPage(10),
      store.recommendationPendingPage(10),
      store.recommendationEntriesPage(fixture.playlistId, [cursor.orderKey, cursor.syncId]),
      store.recommendationFeedbackPage(fixture.playlistId, "offer-10"),
    ]) {
      const traced = traceQueries(fixture.db, () =>
        Effect.runSync(read as Effect.Effect<unknown, unknown>),
      );
      assert.ok(traced.queries.every((q) => q.rows <= 128));
      assert.ok(traced.queries.every((q) => !q.sql.includes("OFFSET")));
      assert.ok(traced.queries.every((q) => q.plan.some((line) => line.includes("SEARCH"))));
      assert.ok(
        traced.queries.every((q) => !q.plan.some((line) => line.includes("USE TEMP B-TREE"))),
      );
    }
  } finally {
    fixture.close();
  }
});

test("source invalidation listeners are singular and released on disposal", async () => {
  const { observePlaylistRecommendationInputs } = await import("./playlistRecommendationInputs.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const changes = new Set<(change: import("@wave/core").LibraryChange) => void>(),
      catalog = new Set<() => void>();
    const source = observePlaylistRecommendationInputs(
      store,
      Effect.void,
      (f) => {
        changes.add(f);
        return () => {
          changes.delete(f);
        };
      },
      (f) => {
        catalog.add(f);
        return () => {
          catalog.delete(f);
        };
      },
    );
    assert.deepEqual([changes.size, catalog.size], [1, 1]);
    const first = await Effect.runPromise(source.get(fixture.playlistId));
    for (const f of changes) f({ kind: "playlists", ids: [999] });
    const same = await Effect.runPromise(source.get(fixture.playlistId));
    assert.equal(same.library, first.library);
    for (const f of changes) f({ kind: "favorites" });
    const star = await Effect.runPromise(source.get(fixture.playlistId));
    assert.notEqual(star.library, first.library);
    for (const f of catalog) f();
    const fresh = await Effect.runPromise(source.get(fixture.playlistId));
    assert.notEqual(fresh.library, star.library);
    source.dispose();
    assert.deepEqual([changes.size, catalog.size], [0, 0]);
  } finally {
    fixture.close();
  }
});
