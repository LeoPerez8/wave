import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import {
  magicArtistKey,
  magicLibrarySongs,
  magicYtSong,
  tasteProfile,
  magicQueuePicks,
  refreshedMagicQueuePicks,
  seededRandom,
  tasteLearned,
  ytTrackId,
  type YtAlbumSong,
} from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import {
  addTrack,
  openTestDatabase,
  traceQueries,
  observeSqlTasks,
} from "../library/db/testDatabase.ts";
import { recordPlay } from "../library/db/playHistory.ts";
import { deleteTracksById } from "../library/db/tracks.ts";
import { buildHomeMagicQueue } from "../home/magicQueueJob.ts";
import {
  readTasteLibrary,
  readTasteHistory,
  deriveTaste,
  deriveTasteFromLibrary,
} from "./tasteDerivation.ts";
import { makeLiveTaste } from "./liveTaste.ts";

test("sparse/deleted/tied/collaborative/multi-genre sources retain ti's complete ordered profile and picks", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const db = fixture.db;
    const store = await loadLibraryStore(root, db);
    db.run(sql`UPDATE play_events SET track_id = 999999, started_at = 0 WHERE id <= 128`);
    db.run(sql`UPDATE play_events SET started_at = 1 WHERE id > 128 AND id <= 500`);
    db.run(sql`DELETE FROM favorites`);
    db.run(sql`INSERT INTO favorites (track_id, added_at, changed_at, phone_id, deleted)
      SELECT id, ${fixture.now}, ${fixture.now}, 'sparse', id <= 200 FROM tracks WHERE id <= 300`);
    db.run(sql`UPDATE tracks SET video_id = NULL WHERE id <= 128`);
    db.run(sql`UPDATE tracks SET genres = '["Rock","Metal"]', title_sort = 'tie' WHERE id <= 20`);
    db.run(
      sql`UPDATE tracks SET title_sort = CASE id % 3 WHEN 0 THEN 'tie' WHEN 1 THEN '𐀀' ELSE '' END WHERE id BETWEEN 21 AND 40`,
    );
    db.run(
      sql`UPDATE tracks SET path = '/tie/' || printf('%04d', 100-id) WHERE id <= 20 AND path IS NOT NULL`,
    );
    db.run(
      sql`UPDATE artists SET sort = CASE id % 3 WHEN 0 THEN 'tie' WHEN 1 THEN '𐀀' ELSE '' END`,
    );
    db.run(
      sql`INSERT INTO track_artists (track_id,artist_id,position) VALUES (${fixture.songIds[1]!},${fixture.targets.large.artistId},1)`,
    );
    deleteTracksById(db, fixture.songIds.slice(600, 620));
    const convert = magicLibrarySongs(Effect.runSync(store.listArtists));
    const songs = Effect.runSync(store.listSongs);
    const magic = songs.map(convert);
    const playable = songs.filter((song) => song.path !== null).map(convert);
    const byId = new Map(magic.map((song) => [song.trackId, song]));
    const history = Effect.runSync(store.tasteHistory);
    const expected = tasteProfile(history, (id) => byId.get(id), fixture.now);
    assert.deepEqual(Effect.runSync(readTasteHistory(store, Effect.void)), history);
    const library = Effect.runSync(readTasteLibrary(store, Effect.void));
    assert.deepEqual(library.magic, magic);
    const profile = Effect.runSync(deriveTaste(store, Effect.void, fixture.now, library));
    for (const key of ["songs", "artists", "genres"] as const)
      assert.deepEqual([...profile[key]], [...expected[key]]);
    const saved = {
      day: "yesterday",
      trackIds: ["gone", ...playable.slice(0, 8).map((song) => song.trackId)],
      shownToday: [],
    };
    for (const refresh of [false, true]) {
      const picked = Effect.runSync(
        buildHomeMagicQueue(store, saved, {
          now: fixture.now,
          random: seededRandom("sparse"),
          turn: Effect.void,
          refresh,
          taste: (snapshot) => deriveTaste(store, Effect.void, fixture.now, snapshot),
        }),
      );
      assert.deepEqual(
        picked,
        (refresh ? refreshedMagicQueuePicks : magicQueuePicks)(saved, playable, {
          now: fixture.now,
          taste: expected,
          random: seededRandom("sparse"),
        }),
      );
    }
  } finally {
    fixture.close();
  }
});

test("cancelling a paged shared profile retains pending signals and releases the one live lock", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    fixture.db.run(sql`DELETE FROM favorites`);
    const queue: (() => void)[] = [];
    const turn = Effect.callback<void>((resume) => {
      const run = () => resume(Effect.void);
      queue.push(run);
      return Effect.sync(() => {
        const index = queue.indexOf(run);
        if (index >= 0) queue.splice(index, 1);
      });
    });
    const convert = magicLibrarySongs(Effect.runSync(store.listArtists));
    const songs = new Map(
      Effect.runSync(store.listSongs).map((song) => [String(song.id), convert(song)]),
    );
    const remote = { ...songs.values().next().value!, trackId: ytTrackId("cancelled") };
    const live = makeLiveTaste({
      derive: deriveTaste(store, turn, fixture.now),
      deriveWithSnapshot: (snapshot) => deriveTaste(store, turn, fixture.now, undefined, snapshot),
      songsOf: (ids) =>
        Effect.succeed(
          ids.map((id) => (id === remote.trackId ? remote : songs.get(id)!)).filter(Boolean),
        ),
    });
    const controller = new AbortController();
    const first = Effect.runPromise(live.profile, { signal: controller.signal });
    for (let i = 0; i < 10; i++) {
      assert.equal(queue.length, 1);
      queue.shift()!();
      await new Promise((resolve) => setImmediate(resolve));
    }
    const id = String(fixture.songIds[9]!);
    await Effect.runPromise(live.marked("favorite", [id, remote.trackId], fixture.now));
    controller.abort();
    await assert.rejects(first);
    assert.equal(queue.length, 0, "cancelled source work releases its pending turn");
    Effect.runSync(store.setFavorites([Number(id)], true));
    const actual = await Effect.runPromise(
      live.profileUsing((snapshot) =>
        deriveTaste(store, Effect.void, fixture.now, undefined, snapshot),
      ),
    );
    const expected = tasteLearned(
      tasteProfile(
        Effect.runSync(store.tasteHistory),
        (trackId) => songs.get(trackId),
        fixture.now,
      ),
      { kind: "favorite", song: remote, at: fixture.now },
    );
    assert.deepEqual(actual, expected);
    for (const key of ["songs", "artists", "genres"] as const)
      assert.deepEqual([...actual![key]], [...expected[key]]);
  } finally {
    fixture.close();
  }
});

test("a write between taste pages restarts the snapshot instead of publishing mixed history", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let turns = 0;
    const profile = Effect.runSync(
      deriveTaste(
        store,
        Effect.sync(() => {
          if (++turns === 4)
            fixture.db.run(
              sql`UPDATE play_events SET started_at = ${fixture.now}, end_reason = 'completed', listened_ms = 180000 WHERE id = 1`,
            );
        }),
        fixture.now,
      ),
    );
    const convert = magicLibrarySongs(Effect.runSync(store.listArtists));
    const byId = new Map(
      Effect.runSync(store.listSongs).map((song) => [String(song.id), convert(song)]),
    );
    assert.deepEqual(
      profile,
      tasteProfile(Effect.runSync(store.tasteHistory), (id) => byId.get(id), fixture.now),
    );
  } finally {
    fixture.close();
  }
});

const root = fileURLToPath(new URL("../../../../", import.meta.url));
test("SQL bench observation covers actual taste statements and cleans up independently of replay completion", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const samples: { sql: string; ms: number }[] = [];
    const stop = observeSqlTasks(fixture.db, (statement, ms) =>
      samples.push({ sql: statement, ms }),
    );
    try {
      Effect.runSync(store.tasteRevision);
      Effect.runSync(store.mixSongsPage(0, { genres: false }));
      Effect.runSync(store.tastePlaysPage([-Number.MAX_VALUE, 0]));
    } finally {
      stop();
    }
    assert.equal(samples.length, 4);
    assert.ok(samples.every((sample) => Number.isFinite(sample.ms) && sample.ms >= 0));
    const before = samples.length;
    Effect.runSync(store.tasteArtistsPage(0));
    assert.equal(samples.length, before);
  } finally {
    fixture.close();
  }
});
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
    assert.equal(
      songs.reduce((n, q) => n + q.rows, 0),
      1000,
    );
    assert.ok(queries.every((query) => query.rows <= 128));
    assert.ok(queries.every((query) => !/OFFSET/i.test(query.sql)));
    assert.equal(
      queries.filter((q) => /FROM artists a/.test(q.sql)).reduce((n, q) => n + q.rows, 0),
      fixture.db.all<{ id: number }>(sql`SELECT id FROM artists`).length,
    );
    const live = makeLiveTaste({
      derive: deriveTaste(store, turn, fixture.now),
      songsOf: () => Effect.succeed([]),
      between: turn,
    });
    const due = traceQueries(fixture.db, () =>
      Effect.runSync(
        buildHomeMagicQueue(store, null, {
          now: fixture.now,
          random: () => 0.5,
          turn,
          taste: (library) =>
            live.profileUsing((snapshot) =>
              deriveTaste(store, turn, fixture.now, library, snapshot),
            ),
        }),
      ),
    );
    assert.equal(
      due.queries.filter((q) => q.sql.includes('"tracks"."title"')).reduce((n, q) => n + q.rows, 0),
      1000,
    );
    assert.ok(due.queries.every((q) => q.rows <= 128 && !/OFFSET/i.test(q.sql)));
    const warm = traceQueries(fixture.db, () => Effect.runSync(live.profile));
    assert.deepEqual(warm.result, expected);
    assert.equal(warm.queries.length, 0, "mixes reuse Home's live profile without source reads");
    assert.deepEqual(
      due.result,
      magicQueuePicks(
        null,
        expectedSongs.filter((song) =>
          result.library.playable.some((s) => s.trackId === song.trackId),
        ),
        { now: fixture.now, taste: expected, random: () => 0.5 },
      ),
    );
    assert.ok(turns >= 5);
  } finally {
    fixture.close();
  }
});

test("a Magic Queue's cold taste uses its recommendation Library without another song read", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const library = {
      songs: Effect.runSync(store.listSongs),
      artists: Effect.runSync(store.listArtists),
    };
    const convert = magicLibrarySongs(library.artists);
    const byId = new Map(library.songs.map((song) => [String(song.id), convert(song)]));
    const expected = tasteProfile(
      Effect.runSync(store.tasteHistory),
      (id) => byId.get(id),
      fixture.now,
    );
    const { result, queries } = traceQueries(fixture.db, () =>
      Effect.runSync(deriveTasteFromLibrary(store, Effect.void, fixture.now, library)),
    );
    assert.deepEqual(result, expected);
    assert.equal(queries.filter((query) => query.sql.includes('"tracks"."title"')).length, 0);
  } finally {
    fixture.close();
  }
});

/** A streamed song as the profile weighs it, by its artists alone. */
const streamedSong = (track: { readonly id: string; readonly artists: readonly string[] }) =>
  magicYtSong({ trackId: track.id, artists: track.artists }, () => null);

/** A play of [trackId] played through, or skipped after 5 s. */
const endedPlay = (trackId: string, startedAt: number, endReason: "completed" | "skipped") => ({
  trackId,
  context: null,
  startedAt,
  listenedMs: endReason === "completed" ? 284_000 : 5_000,
  durationMs: 284_000,
  endReason,
  counted: endReason === "completed",
  source: "phone" as const,
});

test("rebuilding the profile gives streamed songs the scores the live updates gave them", async () => {
  const db = await openTestDatabase();
  const store = await loadLibraryStore(root, db);
  const now = 50 * 24 * 60 * 60 * 1000;
  const airbag: YtAlbumSong = {
    videoId: "v-airbag",
    title: "Airbag",
    artists: ["Radiohead", "Guest"],
    album: "OK Computer",
    durationMs: 284_000,
    artworkUrl: null,
    explicit: false,
    albumId: null,
  };
  const streamed = ytTrackId(airbag.videoId);
  const local = addTrack(db, { title: "Local", artist: "Radiohead" });
  recordPlay(db, endedPlay(String(local), 1_000, "completed"));
  const derive = () => deriveTaste(store, Effect.void, now, undefined, undefined, streamedSong);
  const live = makeLiveTaste({
    derive: derive(),
    songsOf: (ids) =>
      Effect.succeed(
        ids.flatMap((id) =>
          id === streamed ? [streamedSong({ id, artists: airbag.artists })] : [],
        ),
      ),
  });
  await Effect.runPromise(live.profile);
  for (const [at, end] of [
    [now - 40 * 24 * 60 * 60 * 1000, "completed"],
    [now - 1_000, "completed"],
    [now - 500, "skipped"],
  ] as const) {
    const ended = endedPlay(streamed, at, end);
    recordPlay(db, ended, false, airbag);
    await Effect.runPromise(live.played(ended));
  }
  const learned = (await Effect.runPromise(live.profile))!;
  const rebuilt = await Effect.runPromise(derive());
  assert.ok(learned.songs.has(streamed));
  assert.equal(rebuilt.songs.get(streamed), learned.songs.get(streamed));
  for (const artist of ["Radiohead", "Guest"].map(magicArtistKey))
    assert.ok(
      Math.abs(rebuilt.artists.get(artist)! - learned.artists.get(artist)!) < 1e-12,
      artist,
    );
});
