/** Inherited small-read costs; actual selected-revision APIs and full-row equivalence. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import {
  addHistory,
  traceArtistCreditVisits,
  traceQueries,
} from "../../../src/library/db/testDatabase.ts";
import { selectArtistsBefore600 } from "../artistCountReference.ts";
import { loadLibraryStore } from "../store.ts";
import type { FastAgainBench } from "../types.ts";

export const bench: FastAgainBench = {
  name: "boundedReads",
  async run(context) {
    const { fixture, measure } = context;
    const store = await loadLibraryStore(context.root, fixture.db);
    const tracks = await context.loadModule<typeof import("../../../src/library/db/tracks.ts")>(
      "apps/mobile/src/library/db/tracks.ts",
    );
    const schema = await context.loadModule<typeof import("../../../src/library/db/schema.ts")>(
      "apps/mobile/src/library/db/schema.ts",
    );
    const ids = [fixture.targets.small.artistId, fixture.targets.large.artistId];
    const page10 = { offset: 3, limit: 10 };
    const page50 = { offset: 0, limit: 50 };
    const deepPage = { offset: Math.floor(fixture.size / 25) - 10, limit: 10 };
    const ranked = () => Effect.runSync(store.artistsByIds(ids));
    const paged = () => Effect.runSync(store.listArtistsPage(page10));
    const expectedRanked = selectArtistsBefore600(fixture.db, { ids });
    const expectedPage = selectArtistsBefore600(fixture.db, { page: page10, scope: "files" });
    const artistRead = (
      read: string,
      run: typeof ranked,
      expected: ReturnType<typeof ranked>,
      timingName: string,
      growth = 0,
    ) => {
      assert.deepEqual(run(), expected, `${read}: complete rows/counts differ from pre-#600`);
      const observed = traceArtistCreditVisits(fixture.db, run);
      assert.deepEqual(observed.result, expected, `${read}: observation changed results`);
      return measure(read, run, {
        resultKey: JSON.stringify,
        details: {
          source: "actual selected-revision LibraryStore API; reference SQL frozen at 2aae3bb8",
          readTimingName: timingName,
          unrelatedTracksAdded: growth,
          creditKeyEvaluations: observed.visits,
          workCaveat:
            "identity-function views observe credit keys fed to joins/UNION, not VM instructions; plans and timings are uninstrumented",
          queryPlans: traceQueries(fixture.db, run).queries.map((query) => query.plan),
        },
      });
    };
    const results = [
      artistRead("artistsByIds/2", ranked, expectedRanked, "read ranked artists"),
      artistRead(
        "listArtistsPage/50",
        () => Effect.runSync(store.listArtistsPage(page50)),
        selectArtistsBefore600(fixture.db, { page: page50, scope: "files" }),
        "list artists",
      ),
      artistRead("listArtistsPage/10", paged, expectedPage, "list artists"),
      artistRead(
        "listArtistsPage/deep10",
        () => Effect.runSync(store.listArtistsPage(deepPage)),
        selectArtistsBefore600(fixture.db, { page: deepPage, scope: "files" }),
        "list artists",
      ),
    ];
    // New artists sort after the fixed page, leaving target/page membership and counts unchanged.
    // Grow both unrelated tracks and credits, with no timing of seeding or trace instrumentation.
    addHistory(fixture.db, { artist: "zzzz unrelated growth", tracks: fixture.size, plays: 1 });
    assert.deepEqual(selectArtistsBefore600(fixture.db, { ids }), expectedRanked);
    assert.deepEqual(
      selectArtistsBefore600(fixture.db, { page: page10, scope: "files" }),
      expectedPage,
    );
    results.push(
      artistRead(
        "artistsByIds/2+unrelated",
        ranked,
        expectedRanked,
        "read ranked artists",
        fixture.size,
      ),
      artistRead("listArtistsPage/10+unrelated", paged, expectedPage, "list artists", fixture.size),
    );
    const genre = Effect.runSync(store.getGenre(fixture.genreId))!;
    const page = () =>
      tracks
        .trackQuery(fixture.db)
        .where(eq(schema.tracks.genreId, fixture.genreId))
        .orderBy(...tracks.BY_TITLE)
        .limit(50)
        .all();
    assert.deepEqual(page(), genre.songs.slice(0, 50), "genre prefix differs");
    results.push(
      measure("genre/allRows", () => Effect.runSync(store.getGenre(fixture.genreId)), {
        resultKey: (value) => JSON.stringify(value!.songs.map((song) => song.id)),
        details: {
          source: "actual LibraryStore.getGenre; whole genre read; after unrelated growth",
        },
      }),
      measure("genre/first50Probe", page, {
        resultKey: (value) => JSON.stringify(value.map((song) => song.id)),
        details: {
          source: "actual trackQuery projection/BY_TITLE, experimental genre predicate + LIMIT 50",
          caveat:
            "prefix equivalence only; not a production paging/selection/playback implementation",
        },
      }),
    );
    return results;
  },
};
