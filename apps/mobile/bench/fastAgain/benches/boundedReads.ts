/** Additional inherited costs, measured separately from new regression paths. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { scopedArtistProbe } from "../boundedReadProbes.ts";
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
    const actual = () => Effect.runSync(store.artistsByIds(ids));
    const scoped = () => scopedArtistProbe(fixture.db, ids);
    assert.deepEqual(scoped(), actual(), "scoping changed artist rows or counts");
    const genre = Effect.runSync(store.getGenre(fixture.genreId))!;
    const page = () =>
      tracks
        .trackQuery(fixture.db)
        .where(eq(schema.tracks.genreId, fixture.genreId))
        .orderBy(...tracks.BY_TITLE)
        .limit(50)
        .all();
    assert.deepEqual(page(), genre.songs.slice(0, 50), "genre prefix differs");
    return [
      measure("artistRows2/globalCredits", actual, {
        resultKey: JSON.stringify,
        details: {
          source: "actual LibraryStore.artistsByIds; global credited-song UNION",
          queryPlans: traceQueries(fixture.db, actual).queries.map((query) => query.plan),
        },
      }),
      measure("artistRows2/scopedCreditsProbe", scoped, {
        resultKey: JSON.stringify,
        details: {
          source: "experimental SQL; same projection, ids inside both UNION branches",
          queryPlans: traceQueries(fixture.db, scoped).queries.map((query) => query.plan),
        },
      }),
      measure("genre/allRows", () => Effect.runSync(store.getGenre(fixture.genreId)), {
        resultKey: (value) => JSON.stringify(value!.songs.map((song) => song.id)),
        details: { source: "actual LibraryStore.getGenre; whole genre read" },
      }),
      measure("genre/first50Probe", page, {
        resultKey: (value) => JSON.stringify(value.map((song) => song.id)),
        details: {
          source: "actual trackQuery projection/BY_TITLE, experimental genre predicate + LIMIT 50",
          caveat:
            "prefix equivalence only; not a production paging/selection/playback implementation",
        },
      }),
    ];
  },
};
