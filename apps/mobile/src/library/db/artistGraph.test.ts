import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { deleteTracksById } from "./tracks.ts";
import {
  artistGraph,
  artistNeighbours,
  snapshotVersionsAfter,
  writePlaylistYtSong,
  type SnapshotVersions,
} from "@wave/core";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { addTrack, openTestDatabase, traceQueries } from "./testDatabase.ts";
import { creditSplits, relinkCredits } from "./credits.ts";
import { recordPlay } from "./playHistory.ts";
import type { PlayEvent, YtAlbumSong } from "@wave/core";
import { readArtistGraph } from "../../home/artistGraph.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
test("graph pages bound returned work, seek an index, and preserve the complete historical graph", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    // Existing primary/missing tracks, a collaboration, a deleted track, equal-time history,
    // populated catalog/pages, invalid stored entries, and radio evidence spanning pages.
    fixture.db.run(
      sql`INSERT INTO track_artists (track_id, artist_id, position) VALUES (${fixture.songIds[1]!}, ${fixture.targets.large.artistId}, 1)`,
    );
    deleteTracksById(fixture.db, [fixture.songIds[4]!]);
    fixture.db.run(sql`UPDATE play_events SET started_at = 100 WHERE id IN (1,2,3)`);
    for (let n = 0; n < 140; n++) {
      const song = {
        videoId: `graph-${n}`,
        title: `Song ${n}`,
        artists: [n % 2 ? "Burial" : "Portishead", "Kode9"],
        album: null,
        albumId: null,
        durationMs: 180000,
        artworkUrl: null,
        explicit: false,
      };
      fixture.db.run(
        sql`INSERT INTO candidate_songs (video_id,song,first_seen_at,last_seen_at) VALUES (${song.videoId},${writePlaylistYtSong(song)},0,0)`,
      );
      fixture.db.run(
        sql`INSERT INTO candidate_radios (video_id,seed_key,seed_name,last_seen_at) VALUES (${song.videoId}, 'massive attack','Massive Attack',0)`,
      );
    }
    for (let n = 0; n < 140; n++)
      fixture.db.run(
        sql`INSERT INTO candidate_radios (video_id,seed_key,seed_name,last_seen_at) VALUES ('graph-0', ${`z${140 - n}`}, ${`Seed ${n}`},0)`,
      );
    // Stored songs Core's readPlaylistYtSong refuses: the SQL projection must drop each one too.
    const invalid: [string, string][] = [
      ["bad", "not JSON"],
      ["bad-array", '["Burial"]'],
      [
        "bad-empty-id",
        '{"videoId":"","title":"t","artists":["Burial"],"album":null,"artworkUrl":null,"durationMs":1}',
      ],
      [
        "bad-title",
        '{"videoId":"bad-title","artists":["Burial"],"album":null,"artworkUrl":null,"durationMs":1}',
      ],
      [
        "bad-artists",
        '{"videoId":"bad-artists","title":"t","artists":["Burial",3],"album":null,"artworkUrl":null,"durationMs":1}',
      ],
      [
        "bad-artist-object",
        '{"videoId":"bad-artist-object","title":"t","artists":{"0":"Burial"},"album":null,"artworkUrl":null,"durationMs":1}',
      ],
      [
        "bad-album",
        '{"videoId":"bad-album","title":"t","artists":["Burial"],"album":5,"artworkUrl":null,"durationMs":1}',
      ],
      [
        "bad-missing-album",
        '{"videoId":"bad-missing-album","title":"t","artists":["Burial"],"artworkUrl":null,"durationMs":1}',
      ],
      [
        "bad-duration",
        '{"videoId":"bad-duration","title":"t","artists":["Burial"],"album":null,"artworkUrl":null,"durationMs":"1"}',
      ],
      [
        "bad-artwork",
        '{"videoId":"bad-artwork","title":"t","artists":["Burial"],"album":null,"durationMs":1}',
      ],
    ];
    for (const [videoId, song] of invalid)
      fixture.db.run(
        sql`INSERT INTO candidate_songs (video_id,song,first_seen_at,last_seen_at) VALUES (${videoId},${song},0,0)`,
      );
    // Valid but sparse: a null duration and no explicit flag still count.
    fixture.db.run(
      sql`INSERT INTO candidate_songs (video_id,song,first_seen_at,last_seen_at) VALUES ('ok-null-duration','{"videoId":"ok-null-duration","title":"t","artists":["Massive Attack"],"album":null,"artworkUrl":null,"durationMs":null}',0,0)`,
    );
    fixture.db.run(
      sql`INSERT INTO candidate_radios (video_id,seed_key,seed_name,last_seen_at) VALUES ('ok-null-duration','kode9','Kode9',0)`,
    );
    fixture.db.run(
      sql`INSERT INTO yt_artists (artist_key,outcome,checked_at,browse_id,page) VALUES ('portishead','found',0,'UCp',${JSON.stringify(
        {
          name: "Portishead",
          songs: [],
          similar: [
            { name: "Beth Gibbons", browseId: "UCb", audience: null },
            { name: "Burial", browseId: "UCu", audience: null },
          ],
        },
      )})`,
    );
    for (let n = 0; n < 150; n++)
      fixture.db.run(
        sql`INSERT INTO yt_artists (artist_key,outcome,checked_at) VALUES (${`empty-${n}`},'unmatched',0)`,
      );
    const names = new Map(Effect.runSync(store.listArtists).map((a) => [a.id, a.name]));
    const songs = new Map(
      Effect.runSync(store.listSongs).map((s) => [
        String(s.id),
        s.artistIds.flatMap((id) => names.get(id) ?? []),
      ]),
    );
    const expected = artistGraph({
      catalog: Effect.runSync(store.candidateCatalog),
      pages: Effect.runSync(store.ytArtistSimilar),
      plays: Effect.runSync(store.tasteHistory).plays.flatMap((p) =>
        songs.has(p.trackId) ? [{ ...p, artists: songs.get(p.trackId)! }] : [],
      ),
    });
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
    assert.deepEqual(traced.result, expected);
    assert.deepEqual([...traced.result.names], [...expected.names]);
    assert.deepEqual(
      [...traced.result.edges].map(([k, v]) => [k, [...v]]),
      [...expected.edges].map(([k, v]) => [k, [...v]]),
    );
    assert.ok(yields > 100, `only ${yields} yields`);
    assert.ok(traced.queries.every((q) => q.rows <= 128));
    const history = traced.queries.filter((q) => q.sql.includes("FROM play_events"));
    assert.ok(history.length > 70);
    assert.ok(history.every((q) => q.plan.some((p) => /SEARCH.*play_events.*started_at/.test(p))));
    assert.ok(
      traced.queries
        .filter((q) => q.sql.includes("FROM candidate_radios"))
        .every((q) => q.plan.some((step) => /SEARCH.*candidate_radios/.test(step))),
    );
    assert.ok(history.every((q) => !/OFFSET/.test(q.sql)));
  } finally {
    fixture.close();
  }
});

test("cold playlist and Magic Queue share real paged graph work; warm reads are free and disposal releases waiters", async () => {
  const { shareArtistGraph } = await import("../../home/sharedArtistGraph.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let release: (() => void) | undefined;
    let cancelled = 0,
      pages = 0;
    let versions: SnapshotVersions = {};
    const gate = Effect.callback<void>((resume) => {
      release = () => resume(Effect.void);
      return Effect.sync(() => {
        cancelled++;
      });
    });
    const shared = shareArtistGraph(
      Effect.succeed({
        ...store,
        graphPlayPage: (after) =>
          Effect.suspend(() => {
            pages++;
            return store.graphPlayPage(after);
          }),
      }),
      gate,
      Effect.void,
      { versions: () => versions },
    );
    const playlist = Effect.runPromise(shared.get),
      magicQueue = Effect.runPromise(shared.get);
    assert.equal(pages, 0);
    release!();
    const [a, b] = await Promise.all([playlist, magicQueue]);
    assert.equal(a, b);
    assert.equal(pages, Math.ceil(fixture.playEvents / 128) + 1);
    const before = pages;
    assert.equal(await Effect.runPromise(shared.get), a);
    assert.equal(pages, before);
    versions = snapshotVersionsAfter(versions, "plays");
    const waiting = Effect.runPromise(shared.get);
    const rejected = assert.rejects(waiting);
    shared.dispose();
    await rejected;
    await assert.rejects(Effect.runPromise(shared.get));
    assert.equal(cancelled, 1);
  } finally {
    fixture.close();
  }
});

test("a song ending mid-build doesn't rebuild the graph for its waiters; the ask after it gets the rebuilt graph", async () => {
  const { shareArtistGraph } = await import("../../home/sharedArtistGraph.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let builds = 0,
      pages = 0;
    let versions: SnapshotVersions = {};
    const changed = Promise.withResolvers<void>();
    const shared = shareArtistGraph(
      Effect.sync(() => {
        builds++;
        return {
          ...store,
          graphPlayPage: (after: Parameters<typeof store.graphPlayPage>[0]) =>
            Effect.suspend(() => {
              if (++pages === 2) changed.resolve();
              return store.graphPlayPage(after);
            }),
        };
      }),
      Effect.void,
      Effect.promise(() => new Promise<void>((r) => setTimeout(r, 0))),
      { versions: () => versions },
    );
    // Background snapshot warming reads the graph this way.
    const graphNow = shared.get.pipe(Effect.orElseSucceed(() => null));
    const magicQueue = Effect.runPromise(graphNow),
      playlist = Effect.runPromise(graphNow);
    await changed.promise;
    versions = snapshotVersionsAfter(versions, "plays"); // a song ended while the cold graph builds
    const [a, b] = await Promise.all([magicQueue, playlist]);
    assert.notEqual(a, null);
    assert.equal(a, b);
    assert.equal(builds, 1, "the build under way isn't restarted");
    const next = await Effect.runPromise(graphNow);
    assert.notEqual(next, a);
    assert.equal(builds, 2, "the ask after the song reads it");
    assert.deepEqual(next, Effect.runSync(readArtistGraph(store, Effect.void)));
    assert.equal(await Effect.runPromise(graphNow), next);
    shared.dispose();
  } finally {
    fixture.close();
  }
});

test("equal-timestamp history pages seek beyond the prior id instead of rescanning its timestamp prefix", async () => {
  const fixture = await createFastAgainFixture();
  try {
    fixture.db.run(sql`UPDATE play_events SET started_at = 100`);
    const store = await loadLibraryStore(root, fixture.db);
    const first = Effect.runSync(store.graphPlayPage([100, 0]));
    const next = traceQueries(fixture.db, () => Effect.runSync(store.graphPlayPage(first.next!)));
    assert.equal(first.rows.length, 128);
    assert.equal(next.result.rows.length, 128);
    assert.ok(
      next.queries.some((query) =>
        query.plan.some((step) => /started_at=\? AND rowid>\?/.test(step)),
      ),
      JSON.stringify(next.queries.map((q) => q.plan)),
    );
    assert.ok(next.queries.every((query) => query.rows <= 128));
  } finally {
    fixture.close();
  }
});

test("empty decoded pages advance every source cursor and attach radios by their stored catalog key", async () => {
  const { readMixCatalog } = await import("../../home/readMixCatalog.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    fixture.db.transaction((tx) => {
      for (let i = 0; i < 256; i++) {
        tx.run(
          sql`INSERT INTO candidate_songs (video_id,song,first_seen_at,last_seen_at) VALUES (${`invalid-${i}`},'null',0,0)`,
        );
        tx.run(
          sql`INSERT INTO yt_artists (artist_key,outcome,checked_at,page) VALUES (${`a-${i.toString().padStart(3, "0")}`},'found',0,'null')`,
        );
        tx.run(
          sql`INSERT INTO yt_artists (artist_key,outcome,checked_at) VALUES (${`0-unmatched-${i.toString().padStart(3, "0")}`},'unmatched',0)`,
        );
      }
      tx.run(
        sql`INSERT INTO candidate_songs (video_id,song,first_seen_at,last_seen_at) VALUES ('stored-key',${writePlaylistYtSong({ videoId: "metadata-key", title: "t", artists: ["Portishead"], album: null, albumId: null, durationMs: null, artworkUrl: null, explicit: false })},0,0)`,
      );
      tx.run(
        sql`INSERT INTO candidate_radios (video_id,seed_key,seed_name,last_seen_at) VALUES ('stored-key','burial','Burial',0)`,
      );
      tx.run(
        sql`INSERT INTO yt_artists (artist_key,outcome,checked_at,page) VALUES ('z-valid','found',0,${JSON.stringify({ name: "Kode9", similar: [{ name: "Burial", browseId: "b", audience: null }] })})`,
      );
    });
    const firstCatalog = Effect.runSync(store.graphCatalogPage(0));
    assert.equal(firstCatalog.rows.length, 0);
    assert.notEqual(firstCatalog.next, null);
    const firstSimilar = Effect.runSync(store.graphSimilarPage(null));
    assert.equal(firstSimilar.rows.length, 0);
    assert.equal(firstSimilar.next, "0-unmatched-127");
    const catalog = Effect.runSync(store.candidateCatalog);
    assert.deepEqual(Effect.runSync(readMixCatalog(store, Effect.void)), catalog);
    const names = new Map(Effect.runSync(store.listArtists).map((a) => [a.id, a.name]));
    const songs = new Map(
      Effect.runSync(store.listSongs).map((s) => [
        String(s.id),
        s.artistIds.flatMap((id) => names.get(id) ?? []),
      ]),
    );
    const expected = artistGraph({
      catalog,
      pages: Effect.runSync(store.ytArtistSimilar),
      plays: Effect.runSync(store.tasteHistory).plays.flatMap((p) =>
        songs.has(p.trackId) ? [{ ...p, artists: songs.get(p.trackId)! }] : [],
      ),
    });
    const traced = traceQueries(fixture.db, () => Effect.runSync(readArtistGraph(store)));
    assert.deepEqual([...traced.result.names], [...expected.names]);
    assert.deepEqual(
      [...traced.result.edges].map(([key, edges]) => [key, [...edges]]),
      [...expected.edges].map(([key, edges]) => [key, [...edges]]),
    );
    assert.ok(traced.queries.every((query) => query.rows <= 128));
    for (const table of ["candidate_songs", "candidate_radios", "yt_artists"])
      assert.ok(
        traced.queries
          .filter((query) => query.sql.includes(table) && query.sql.includes(">"))
          .every((query) =>
            query.plan.some((step) => step.includes("SEARCH") && step.includes(table)),
          ),
      );
  } finally {
    fixture.close();
  }
});

test("pages of deleted plays advance without skipping the surviving graph and taste history", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    fixture.db.run(sql`UPDATE play_events SET track_id = -1, started_at = 100 WHERE id <= 256`);
    const first = Effect.runSync(store.graphPlayPage([-Number.MAX_VALUE, 0]));
    assert.deepEqual(first, { rows: [], next: [100, 128] });
    const second = Effect.runSync(store.graphPlayPage(first.next!));
    assert.deepEqual(second, { rows: [], next: [100, 256] });
    const resumed = traceQueries(fixture.db, () =>
      Effect.runSync(store.graphPlayPage(second.next!)),
    );
    assert.equal(resumed.result.rows.length, 128);
    assert.ok(resumed.queries.every((query) => query.rows <= 128));
    const tasteFirst = Effect.runSync(store.tastePlaysPage([-Number.MAX_VALUE, 0]));
    assert.deepEqual(tasteFirst, first);
    const tasteSecond = Effect.runSync(store.tastePlaysPage(tasteFirst.next!));
    assert.deepEqual(tasteSecond, second);
    const names = new Map(
      Effect.runSync(store.listArtists).map((artist) => [artist.id, artist.name]),
    );
    const artists = new Map(
      Effect.runSync(store.listSongs).map((song) => [
        String(song.id),
        song.artistIds.map((id) => names.get(id)!),
      ]),
    );
    const expected = artistGraph({
      catalog: [],
      pages: [],
      plays: Effect.runSync(store.tasteHistory).plays.map((play) => ({
        ...play,
        artists: artists.get(play.trackId)!,
      })),
    });
    const graph = Effect.runSync(readArtistGraph(store));
    assert.deepEqual([...graph.names], [...expected.names]);
    assert.deepEqual(
      [...graph.edges].map(([key, edges]) => [key, [...edges]]),
      [...expected.edges].map(([key, edges]) => [key, [...edges]]),
    );
  } finally {
    fixture.close();
  }
});

test("streamed plays join the owner's sessions with their credited artists", async () => {
  const db = await openTestDatabase();
  const roads = addTrack(db, { title: "Roads", artist: "Portishead", album: "Dummy" });
  const archangel = addTrack(db, { title: "Archangel", artist: "Burial", album: "Untrue" });
  db.run(sql`UPDATE tracks SET video_id = 'v-archangel' WHERE id = ${archangel}`);
  addTrack(db, { title: "Hymn", artist: "Simon & Garfunkel", album: "Hits" });
  relinkCredits(db, creditSplits());
  const store = await loadLibraryStore(root, db);
  const play = (trackId: string, startedAt: number): PlayEvent => ({
    trackId,
    context: null,
    startedAt,
    listenedMs: 180_000,
    durationMs: 180_000,
    endReason: "completed",
    counted: true,
    source: "phone",
  });
  const online = (videoId: string, artists: string[]): YtAlbumSong => ({
    videoId,
    title: videoId,
    artists,
    album: null,
    albumId: null,
    durationMs: 180_000,
    artworkUrl: null,
    explicit: false,
  });
  recordPlay(db, play(String(roads), 0));
  // An unknown duo splits as Stats credits it; one the Library knows whole stays whole.
  recordPlay(db, play("yt:v-teardrop", 200_000), false, online("v-teardrop", ["Massive Attack & Tricky"]));
  recordPlay(db, play("yt:v-hymn", 400_000), false, online("v-hymn", ["Simon & Garfunkel"]));
  // The download of a streamed video: its plays are the Library song's, by its artists.
  recordPlay(db, play("yt:v-archangel", 600_000), false, online("v-archangel", ["Someone Else"]));

  const graph = Effect.runSync(readArtistGraph(store));

  const at = (startedAt: number, artists: string[]) => ({
    startedAt,
    listenedMs: 180_000,
    endReason: "completed" as const,
    artists,
  });
  assert.deepEqual(
    graph,
    artistGraph({
      catalog: [],
      pages: [],
      plays: [
        at(0, ["Portishead"]),
        at(200_000, ["Massive Attack", "Tricky"]),
        at(400_000, ["Simon & Garfunkel"]),
        at(600_000, ["Burial"]),
      ],
    }),
  );
  assert.ok(artistNeighbours(graph, "Portishead").some((n) => n.name === "Massive Attack"));
  assert.ok(artistNeighbours(graph, "Simon & Garfunkel").some((n) => n.name === "Burial"));
});
