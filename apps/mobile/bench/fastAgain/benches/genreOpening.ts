/** #601: bounded opening and cooperative browsing, against each revision's real genre reader. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type LibrarySongSort } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { toSongSummary } from "../../../src/library/db/songOrder.ts";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import type { SongRow, SongSummary } from "../../../src/library/LibraryStore.ts";
import { measureCooperative } from "../cooperative.ts";
import { loadLibraryStore } from "../store.ts";
import type { BenchMeasurement, FastAgainBench } from "../types.ts";

const key = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const summary = (song: SongRow): SongSummary =>
  toSongSummary({
    id: song.id,
    title: song.title,
    artist: song.artist,
    durationMs: song.durationMs,
    thumbPath: song.thumbPath,
    path: song.path,
    explicit: song.explicit ?? "unknown",
    albumId: song.albumId,
    artistId: song.artistId,
    hasLyrics: song.hasLyrics,
    genre: song.genre,
    trackNumber: song.trackNumber,
    year: song.year,
  });

export const bench: FastAgainBench = {
  name: "genreOpening",
  async run(context) {
    const { fixture, measure } = context;
    const store = await loadLibraryStore(context.root, fixture.db);
    const core = await context.loadModule<
      typeof import("../../../../../packages/core/src/index.ts")
    >("packages/core/src/index.ts");
    const paged = existsSync(resolve(context.root, "apps/mobile/src/library/genreOrder.ts"));
    const genre = paged
      ? await context.loadModule<typeof import("../../../src/library/genreOrder.ts")>(
          "apps/mobile/src/library/genreOrder.ts",
        )
      : null;
    const legacy = (sort: LibrarySongSort) => {
      const detail = Effect.runSync(store.getGenre(fixture.genreId))!;
      return { genre: detail.genre, songs: core.sortSongs(detail.songs, sort).map(summary) };
    };
    const results: BenchMeasurement[] = [];
    const title: LibrarySongSort = { key: "title", descending: false };
    const known = legacy(title).genre;
    results.push(
      measure("header/known", () => known, {
        resultKey: key,
        details: {
          phase: "known list header rendered without a database read; React/layout excluded",
        },
      }),
    );
    for (const sort of core.SONG_SORTS) {
      const label = `${sort.key}/${sort.descending ? "desc" : "asc"}`;
      const first = () => {
        if (!paged) {
          const detail = legacy(sort);
          return { genre: detail.genre, songs: detail.songs.slice(0, 50) };
        }
        const opening = Effect.runSync(store.openGenre(fixture.genreId, sort))!;
        return { genre: opening.genre, songs: opening.songs };
      };
      const expected = legacy(sort);
      assert.deepEqual(first(), { genre: expected.genre, songs: expected.songs.slice(0, 50) });
      const plans = traceQueries(fixture.db, first).queries;
      for (const phase of ["coldHeader", "knownHeader"]) {
        results.push(
          measure(`${label}/first50/${phase}`, first, {
            resultKey: key,
            details: {
              source: paged
                ? "actual LibraryStore.openGenre"
                : "actual getGenre + selected Core sortSongs; faithful pre-601 data-ready replay",
              cache:
                "fresh screen/shared-query state; warm SQLite/module; setup and migrations excluded",
              phase:
                phase === "knownHeader"
                  ? "first content after the already known header"
                  : "header and first content data ready",
              queryPlans: plans,
            },
          }),
        );
      }
      // Replay a scroll through every summary page, yielding at the production read seams.
      const traversal = (turn: Effect.Effect<void>) =>
        Effect.gen(function* () {
          yield* turn;
          if (genre === null) return legacy(sort);
          const opening = yield* store.openGenre(fixture.genreId, sort);
          const order = yield* genre.readGenreOrder(
            store,
            fixture.genreId,
            sort,
            opening!.order,
            turn,
          );
          const songs = [...opening!.songs];
          for (let start = 50; start < order.ids.length; start += 50) {
            yield* turn;
            songs.push(...(yield* store.songSummaries(order.ids.slice(start, start + 50))));
          }
          return { genre: opening!.genre, songs };
        });
      const traced = traceQueries(fixture.db, () => Effect.runSync(traversal(Effect.void)));
      assert.deepEqual(traced.result, expected, `${label}: every complete summary must match`);
      const later = traced.queries.filter((query) => query.sql.includes("FROM genre_order o"));
      const measurement = await measureCooperative(
        fixture.db,
        `${label}/allPages`,
        context.runs,
        traversal,
        key,
      );
      results.push({
        ...measurement,
        details: {
          ...measurement.details,
          laterPagePlans: later.slice(1, 3).concat(later.length > 3 ? later.slice(-1) : []),
          semanticEquality:
            "complete ordered summaries/counts, all eight sorts, compared to actual selected-revision getGenre and Core sortSongs",
          phase:
            "opening, settled whole ID order, then a sequential scroll through every summary page; not one opening task",
        },
      });
    }
    // A scan retitles one song and makes it missing; another leaves the genre.
    // Setup/write cost is outside the read timing; restore after every variant.
    fixture.db.run(sql`SAVEPOINT genre_bench_mutation`);
    try {
      const ids = legacy(title).songs.map((song) => song.id);
      fixture.db.run(sql`UPDATE tracks SET title_sort = '', path = NULL WHERE id = ${ids.at(-1)!}`);
      fixture.db.run(sql`UPDATE tracks SET genre_id = NULL WHERE id = ${ids[75]!}`);
      const expected = legacy(title);
      const read = () =>
        paged ? Effect.runSync(store.openGenre(fixture.genreId, title))! : legacy(title);
      const first = () => {
        const detail = read();
        return { genre: detail.genre, songs: detail.songs.slice(0, 50) };
      };
      assert.deepEqual(first(), { genre: expected.genre, songs: expected.songs.slice(0, 50) });
      results.push(
        measure("title/asc/first50/afterScan", first, {
          resultKey: key,
          details: {
            phase: "first content after retitle/missing/genre membership mutation; writes excluded",
            queryPlans: traceQueries(fixture.db, first).queries,
          },
        }),
      );
    } finally {
      fixture.db.run(sql`ROLLBACK TO genre_bench_mutation`);
      fixture.db.run(sql`RELEASE genre_bench_mutation`);
    }
    return results;
  },
};
