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
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
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
