import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";
import { mixKnownSongs, artistPlayTotals, rankPlays, statsWindow } from "@wave/core";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { readMixInputs } from "../../home/mixInputs.ts";
import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { sql } from "drizzle-orm";
import { deleteTracksById } from "./tracks.ts";
import { traceQueries } from "./testDatabase.ts";
const collect = <A>(
  read: (after: number) => Effect.Effect<import("./artistGraph.ts").GraphPage<A, number>, unknown>,
) => {
  const rows: A[] = [];
  let after = 0;
  for (;;) {
    const page = Effect.runSync(read(after));
    rows.push(...page.rows);
    if (page.next === null) return rows;
    after = page.next;
  }
};
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
test("mix, graph and taste pages seek past a cursor with indexed projection lookups", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const pages = [
      ["mixSongsPage", 128, "tracks"],
      ["mixArtistsPage", 128, "a"],
      ["mixCreditPage", 128, "pt"],
      ["mixHistoryPage", 128, "play_events"],
      ["mixStreamedPage", 128, "streamed_songs"],
      ["mixPlaylistedPage", 128, "pi"],
      ["mixCatalogPage", 128, "candidate_songs"],
      ["graphCatalogPage", 128, "candidate_songs"],
      ["graphRadioPage", 128, "candidate_radios"],
      ["tasteFavoritesPage", 128, "favorites"],
      ["tasteDownloadsPage", 128, "tracks"],
    ] as const;
    for (const [name, cursor, table] of pages) {
      const page: Effect.Effect<unknown, unknown> = store[name](cursor);
      const { queries } = traceQueries(fixture.db, () => Effect.runSync(page));
      assert.ok(queries.length > 0, `${name} ran no SQL`);
      for (const query of queries) {
        assert.ok(query.rows <= 128, `${name} returned ${query.rows} rows`);
        assert.match(
          query.plan[0]!,
          new RegExp(`^SEARCH ${table} USING INTEGER PRIMARY KEY \\(rowid>\\?`),
          `${name} must seek the driving source, including the genres range query`,
        );
        assert.doesNotMatch(query.sql, /OFFSET/i);
        // Aggregate co-routines and json_each may scan their local input; joined tables must seek.
        assert.ok(
          query.plan.every(
            (step) =>
              !/^SCAN (?:tracks|artists|albums|track_artists|album_artists|deleted_track_artists|play_events|play_totals|streamed_songs|playlist_items|playlists)\b/.test(
                step,
              ),
          ),
          `${name}: ${query.plan.join("; ")}`,
        );
      }
      if (name === "mixSongsPage") {
        assert.equal(queries.length, 2);
        assert.match(queries[1]!.plan[0]!, /\(rowid>\? AND rowid<\?\)/);
      }
      if (name === "mixArtistsPage") {
        const plan = queries[0]!.plan.join("; ");
        assert.match(plan, /track_artists.*INDEX track_artists_artist_idx \(artist_id=\?\)/);
        assert.match(plan, /albums.*INDEX albums_album_artist_idx \(album_artist_id=\?\)/);
        assert.match(plan, /aa.*INDEX album_artists_artist_idx \(artist_id=\?\)/);
        assert.match(plan, /t.*INDEX tracks_album_idx \(album_id=\?\)/);
      }
    }
    const similar = traceQueries(fixture.db, () => Effect.runSync(store.graphSimilarPage("a")));
    assert.equal(similar.queries.length, 1);
    assert.ok(similar.queries[0]!.rows <= 128);
    assert.match(similar.queries[0]!.plan[0]!, /^SEARCH yt_artists.*\(artist_key>\?\)/);
    for (const name of ["graphPlayPage", "tastePlaysPage"] as const) {
      const page: Effect.Effect<unknown, unknown> = store[name]([100, 128]);
      const { queries } = traceQueries(fixture.db, () => Effect.runSync(page));
      assert.equal(queries.length, 2);
      assert.ok(queries.reduce((rows, query) => rows + query.rows, 0) <= 128);
      assert.match(
        queries[0]!.plan[0]!,
        /play_events_started_at_idx \(started_at=\? AND rowid>\?\)/,
      );
      assert.match(queries[1]!.plan[0]!, /play_events_started_at_idx \(started_at>\?\)/);
      assert.ok(queries.every((query) => !/OFFSET/i.test(query.sql)));
    }
  } finally {
    fixture.close();
  }
});

test("daily mix pages preserve complete Library order/credits/genres and all-time play totals", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    fixture.db.run(
      sql`INSERT INTO track_artists (track_id,artist_id,position) VALUES (${fixture.songIds[1]!},${fixture.targets.large.artistId},1)`,
    );
    fixture.db.run(
      sql`UPDATE tracks SET genres = '["Rock","Alternative Metal"]' WHERE id = ${fixture.songIds[1]!}`,
    );
    fixture.db.run(sql`UPDATE play_events SET started_at = ${fixture.now + 1000} WHERE id = 2`);
    deleteTracksById(fixture.db, [fixture.songIds[3]!]);
    const genres = new Map(Effect.runSync(store.listSongGenres).map((row) => [row.id, row.genres]));
    const expected = {
      songs: Effect.runSync(store.listSongs).map((song) => {
        const values = genres.get(song.id);
        return values === undefined ? song : { ...song, genres: values };
      }),
      artists: Effect.runSync(store.listArtists),
      plays: Effect.runSync(store.trackPlayTotals(statsWindow("all", fixture.now))),
    };
    const ranks = rankPlays(
      artistPlayTotals(Effect.runSync(store.creditedPlayTotals(statsWindow("all", fixture.now)))),
      20,
    );
    const artistRows = new Map(expected.artists.map((artist) => [artist.id, artist]));
    const top = ranks.flatMap((rank) => {
      const artist = artistRows.get(rank.id);
      return artist === undefined
        ? []
        : [{ id: artist.id, name: artist.name, countedPlays: rank.countedPlays }];
    });
    let turns = 0;
    const traced = traceQueries(fixture.db, () =>
      Effect.runSync(
        readMixInputs(
          store,
          Effect.sync(() => {
            turns++;
          }),
          fixture.now,
        ),
      ),
    );
    assert.deepEqual(traced.result.songs, expected.songs);
    assert.deepEqual(traced.result.artists, expected.artists);
    assert.deepEqual(traced.result.plays, expected.plays);
    assert.deepEqual(traced.result.topArtists, top);
    const known = mixKnownSongs({
      library: expected.songs,
      playedRecordingKeys: Effect.runSync(store.playedRecordingKeys),
      streamed: Effect.runSync(store.streamedSongs),
      playlisted: Effect.runSync(store.playlistedSongs),
    });
    assert.deepEqual(traced.result.known.nonD, known.nonD);
    for (const song of expected.songs) {
      const online = {
        videoId: `v${song.id}`,
        artworkUrl: null,
        explicit: false,
        title: song.title,
        artists: [song.artist],
        durationMs: song.durationMs,
        album: song.album,
      };
      assert.equal(traced.result.known.known(online), known.known(online));
      assert.deepEqual(traced.result.known.inLibrary(online), known.inLibrary(online));
    }
    assert.ok(turns > 100);
    assert.ok(traced.queries.every((q) => q.rows <= 128));
    assert.ok(traced.queries.every((q) => !/OFFSET/.test(q.sql)));
  } finally {
    fixture.close();
  }
});

test("taste paging preserves ti history order, end reasons, favorites/downloads and primary genre inputs", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    fixture.db.run(sql`UPDATE play_events SET started_at = 100 WHERE id <= 300`);
    fixture.db.run(
      sql`UPDATE tracks SET genres = '["Rock","Metal"]' WHERE id = ${fixture.songIds[1]!}`,
    );
    const expected = Effect.runSync(store.tasteHistory);
    const traced = traceQueries(fixture.db, () => {
      const plays: import("@wave/core").TasteHistory["plays"][number][] = [];
      let cursor: readonly [number, number] = [-Number.MAX_VALUE, 0];
      for (;;) {
        const page = Effect.runSync(store.tastePlaysPage(cursor));
        plays.push(...page.rows);
        if (page.next === null) break;
        cursor = page.next;
      }
      const favorites = collect(store.tasteFavoritesPage),
        downloads = collect(store.tasteDownloadsPage);
      return { plays, favorites, downloads };
    });
    assert.deepEqual(traced.result, expected);
    assert.ok(traced.queries.every((query) => query.rows <= 128 && !/OFFSET/.test(query.sql)));
    assert.ok(
      traced.queries.some((query) =>
        query.plan.some((step) => /started_at=\? AND rowid>\?/.test(step)),
      ),
    );
    const page = Effect.runSync(store.mixSongsPage(0, { genres: false }));
    const original = new Map(Effect.runSync(store.listSongs).map((song) => [song.id, song]));
    for (const song of page) assert.deepEqual(song, original.get(song.id));
  } finally {
    fixture.close();
  }
});
