import assert from "node:assert/strict";
import test from "node:test";
import type { LibraryChange } from "@wave/core";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";
import { createFastAgainFixture } from "./db/fastAgainFixture.ts";
import { traceQueries } from "./db/testDatabase.ts";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { observePlaylistRecommendationInputs } from "./playlistRecommendationInputs.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

type Store = Parameters<typeof observePlaylistRecommendationInputs>[0];

/** Playlist inputs over a snapshot of [store], with [write] publishing a write as the app does. */
const snapshotOf = (store: Store, between: Effect.Effect<void>) => {
  const changes = new Set<(change: LibraryChange) => void>();
  const source = observePlaylistRecommendationInputs(store, between, (listener) => {
    changes.add(listener);
    return () => changes.delete(listener);
  });
  return {
    ...source,
    write: (kind: LibraryChange["kind"]) => {
      for (const listener of changes) listener({ kind });
    },
    listeners: () => changes.size,
  };
};

test("snapshot-backed input equals historical input, reads in bounded turns, and a warm ask reads only the playlist's own rows", async () => {
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
    for (const name of Object.keys(store) as (keyof typeof store)[]) {
      if (!name.endsWith("Page")) continue;
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
    const source = snapshotOf(wrapped, between);
    const input = await Effect.runPromise(source.get(fixture.playlistId));
    const { songById, ...historical } = input;
    assert.deepEqual(historical, expected);
    assert.equal(songById.size, 1000);
    assert.ok(turns > 20);
    assert.ok(maxRows <= 256, `SQL rows per turn: ${maxRows}`);
    const before = totalRows;
    const again = await Effect.runPromise(source.get(fixture.playlistId));
    assert.ok(totalRows - before < 60, "warm reads only scoped membership/feedback");
    assert.equal(
      again.library,
      input.library,
      "the Library's tracks are derived once per snapshot",
    );
    assert.equal(source.listeners(), 1);
    source.dispose();
    assert.equal(source.listeners(), 0, "its write listeners are released with it");
  } finally {
    fixture.close();
  }
});

test("suggestion inputs never page the candidate catalog: the radios replace it", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let catalogPages = 0;
    const counted = {
      ...store,
      mixCatalogPage: (after: number) => {
        catalogPages++;
        return store.mixCatalogPage(after);
      },
    };
    const source = snapshotOf(counted, Effect.void);
    const input = await Effect.runPromise(source.get(fixture.playlistId));
    assert.equal(catalogPages, 0);
    assert.equal("catalog" in input, false);
    source.dispose();
  } finally {
    fixture.close();
  }
});

test("a star reaches the next suggestions without paging the Library again", async () => {
  const { setFavorites } = await import("./db/playHistory.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let songPasses = 0;
    const counted: Store = {
      ...store,
      mixSongsPage: (after: number) => {
        if (after === 0) songPasses++;
        return store.mixSongsPage(after);
      },
    };
    const source = snapshotOf(counted, Effect.void);
    const [one, two] = await Promise.all([
      Effect.runPromise(source.get(fixture.playlistId)),
      Effect.runPromise(source.get(fixture.playlistId)),
    ]);
    assert.equal(one.library, two.library);
    const id = fixture.songIds.at(-1)!;
    const oldStar = one.library.find((track) => track.id === String(id))!.favorite;
    setFavorites(fixture.db, [id], !oldStar, 1);
    source.write("favorites");
    const changed = await Effect.runPromise(source.get(fixture.playlistId));
    assert.equal(changed.library.find((track) => track.id === String(id))!.favorite, !oldStar);
    assert.equal(songPasses, 1);
    source.dispose();
  } finally {
    fixture.close();
  }
});

test("paged input preserves stream/missing membership, multi-genres and playlist feedback order", async () => {
  const { openTestDatabase, addTrack } = await import("./db/testDatabase.ts");
  const { createPlaylist, addToPlaylist } = await import("./db/playlists.ts");
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
  const pages = [
    {
      id: `song:${seed}`,
      artists: ["Radiohead"],
      songs: [
        { ...song, videoId: "local-video", title: "Edited download" },
        { ...song, videoId: "new", title: "New" },
      ],
    },
  ];
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
  const source = snapshotOf(store, Effect.void);
  const input = await Effect.runPromise(source.get(id));
  const { songById: _rows, ...plain } = input;
  const historical = selectPlaylistRecommendationInput(db, id);
  assert.deepEqual(plain, historical);
  // When each entry joined the playlist (the seed draw's weight), not when its song joined the Library.
  assert.deepEqual(
    input.playlist.map((track) => track.addedAt),
    [1, 1, 1],
  );
  for (const online of [true, false])
    assert.deepEqual(
      playlistRecommendations(input.playlist, { ...input, pages, graph: null, online }),
      playlistRecommendations(historical.playlist, { ...historical, pages, graph: null, online }),
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

test("playlists asking at once share one derivation of the Library's tracks", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const between = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    const source = snapshotOf(store, between);
    const [first, second] = await Promise.all([
      Effect.runPromise(source.get(fixture.playlistId)),
      Effect.runPromise(source.get(fixture.playlistId)),
    ]);
    assert.ok(
      second.library === first.library,
      "the second playlist waits for the first's derivation",
    );
    assert.ok(second.songById === first.songById);
    source.dispose();
  } finally {
    fixture.close();
  }
});
