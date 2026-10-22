import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { deleteTracksById } from "./tracks.ts";
import { artistGraph, writePlaylistYtSong } from "@wave/core";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { traceQueries } from "./testDatabase.ts";
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
    fixture.db.run(
      sql`INSERT INTO candidate_songs (video_id,song,first_seen_at,last_seen_at) VALUES ('bad','not JSON',0,0)`,
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
    shared.forget();
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
