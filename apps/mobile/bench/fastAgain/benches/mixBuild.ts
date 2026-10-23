/** #594: daily Artist then Genre pipelines, loading actual selected-revision Core/store modules. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import * as Effect from "effect/Effect";
import { sql } from "drizzle-orm";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { loadLibraryStore } from "../store.ts";
import { percentiles } from "../measure.ts";
import type { MixIndexes } from "../../../src/home/mixKnown.ts";
import type { FastAgainBench } from "../types.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const bench: FastAgainBench = {
  name: "mixBuild",
  async run(context) {
    const core = await context.loadModule<typeof import("@wave/core")>(
      "packages/core/src/index.ts",
    );
    const store = await loadLibraryStore(context.root, context.fixture.db);
    const stepped = store.mixSongsPage !== undefined;
    const inputs = stepped
      ? await context.loadModule<typeof import("../../../src/home/mixInputs.ts")>(
          "apps/mobile/src/home/mixInputs.ts",
        )
      : null;
    const catalogRead = stepped
      ? await context.loadModule<typeof import("../../../src/home/readMixCatalog.ts")>(
          "apps/mobile/src/home/readMixCatalog.ts",
        )
      : null;
    const graphRead = await context.loadModule<typeof import("../../../src/home/artistGraph.ts")>(
      "apps/mobile/src/home/artistGraph.ts",
    );
    const stats = await context.loadModule<typeof import("../../../src/stats/Stats.ts")>(
      "apps/mobile/src/stats/Stats.ts",
    );
    const stepsModule = stepped
      ? await context.loadModule<typeof import("../../../src/lib/stepped.ts")>(
          "apps/mobile/src/lib/stepped.ts",
        )
      : null;
    const top = Effect.runSync(stats.topAlbumsAndArtists(store, "all", 0, 20)).artists;
    // Populate identical phone cache outside measurement; no network, seeding or module loading is timed.
    context.fixture.db.transaction((tx) => {
      for (let i = 0; i < 1200; i++) {
        const artist = top[i % top.length]!.item.name;
        const song = {
          videoId: `mix-bench-${i}`,
          title: `Fresh candidate ${i}`,
          artists: [artist],
          album: null,
          albumId: null,
          durationMs: 180000,
          artworkUrl: null,
          explicit: false,
        };
        tx.run(
          sql`INSERT INTO candidate_songs (video_id,song,first_seen_at,last_seen_at) VALUES (${song.videoId},${JSON.stringify(song)},${context.fixture.now - 10000},${context.fixture.now})`,
        );
        tx.run(
          sql`INSERT INTO candidate_radios (video_id,seed_key,seed_name,last_seen_at) VALUES (${song.videoId},${core.catalogSeedKey(artist)!},${artist},${context.fixture.now})`,
        );
      }
    });
    const run = async (trace: boolean) => {
      let start = performance.now();
      const tasks: number[] = [];
      let rows = 0,
        statements = 0,
        maxPage = 0;
      const reads = { ...store };
      // Instrument only actual store operations; tracing is separate from timed runs.
      if (trace)
        for (const [name, value] of Object.entries(store)) {
          const measured = <A>(effect: Effect.Effect<A, unknown>) =>
            Effect.sync(() => {
              const result = traceQueries(context.fixture.db, () => Effect.runSync(effect));
              for (const query of result.queries) {
                rows += query.rows;
                statements++;
                maxPage = Math.max(maxPage, query.rows);
              }
              return result.result;
            });
          if (typeof value === "function")
            (reads as Record<string, unknown>)[name] = (...args: unknown[]) =>
              measured((value as (...args: unknown[]) => Effect.Effect<unknown, unknown>)(...args));
          else if (Effect.isEffect(value))
            (reads as Record<string, unknown>)[name] = measured(
              value as Effect.Effect<unknown, unknown>,
            );
        }
      const between = Effect.gen(function* () {
        tasks.push(performance.now() - start);
        yield* Effect.promise(() => setImmediate());
        start = performance.now();
      });
      const step = <A>(work: Generator<void, A>): Effect.Effect<A> =>
        stepsModule === null
          ? Effect.sync(() => {
              for (;;) {
                const next = work.next();
                if (next.done) return next.value;
              }
            })
          : stepsModule.runSteps(work, between);
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const seeded = core.seededRandom("594-daily-sections");
          const draws: number[] = [];
          const random = () => {
            const value = seeded();
            draws.push(value);
            return value;
          };
          let library: MixIndexes;
          if (inputs !== null)
            library = yield* inputs.readMixInputs(reads, between, context.fixture.now);
          else {
            const genres = new Map(
              (yield* reads.listSongGenres).map((row) => [row.id, row.genres]),
            );
            const songs = (yield* reads.listSongs).map((song) => {
              const values = genres.get(song.id);
              return values === undefined ? song : { ...song, genres: values };
            });
            yield* between;
            const artists = yield* reads.listArtists;
            const plays = yield* reads.trackPlayTotals(
              core.statsWindow("all", context.fixture.now),
            );
            yield* between;
            const playedRecordingKeys = yield* reads.playedRecordingKeys;
            yield* between;
            const streamed = yield* reads.streamedSongs,
              playlisted = yield* reads.playlistedSongs;
            yield* between;
            const known = core.mixKnownSongs({
              library: songs,
              playedRecordingKeys,
              streamed,
              playlisted,
            });
            yield* between;
            library = { songs, artists, plays, known, topArtists: [] };
          }
          const catalog =
            catalogRead === null
              ? yield* reads.candidateCatalog
              : yield* catalogRead.readMixCatalog(reads, between);
          const graph = yield* graphRead.readArtistGraph(reads, between);
          const played =
            inputs === null
              ? (yield* stats.topAlbumsAndArtists(reads, "all", 0, 20)).artists.map(
                  ({ item, countedPlays }) => ({ id: item.id, name: item.name, countedPlays }),
                )
              : library.topArtists;
          const pools = {
            played,
            library: stepped
              ? yield* step(
                  core.mapSteps(library.artists, (artist) => ({
                    ...artist,
                    songCount: artist.trackCount,
                  })),
                )
              : library.artists.map((artist) => ({
                  ...artist,
                  songCount: artist.trackCount,
                })),
          };
          // Twenty played seeds need no offline similar fallback in either revision.
          const artistSeeds = stepped
            ? yield* step(core.artistMixSeedsSteps(pools, random))
            : core.artistMixSeeds(pools, random);
          const sections = [];
          for (const kind of ["artist", "genre"] as const) {
            const seeds =
              kind === "artist"
                ? artistSeeds
                : stepped
                  ? yield* step(core.genreMixSeedsSteps(library, random))
                  : core.genreMixSeeds(library, random);
            const variety = Math.floor(random() * 2 ** 31);
            const profiles = stepped
              ? yield* step(core.libraryMixProfilesSteps(library))
              : {
                  profileOf: core.libraryGenreProfiles(library),
                  styleOf: core.libraryStyleOf(library),
                };
            const reader = core.catalogMixReader(
              { catalog, graph, library, ...profiles, taste: null, now: context.fixture.now },
              { variety },
            );
            yield* between;
            for (const seed of seeds) {
              if (reader.readSteps === undefined) reader.read(seed);
              else yield* step(reader.readSteps(seed));
              yield* between;
            }
            const options = {
              known: library.known,
              library,
              ...core.mixSlidersEngine({ faithfulness: 3, popularity: 3 }),
            };
            const mixes = stepped
              ? yield* step(core.discoverMixesOfCatalogSteps(seeds, reader, options))
              : core.discoverMixesOfCatalog(seeds, reader, options);
            sections.push(core.discoverMixesBuilt(mixes, context.fixture.now, seeds, { variety }));
            yield* between;
          }
          return { sections, draws };
        }),
      );
      tasks.push(performance.now() - start);
      return { result, tasks, rows, statements, maxPage };
    };
    const oldNow = Date.now;
    Date.now = () => context.fixture.now;
    try {
      const expected = hash((await run(false)).result);
      const traced = await run(true);
      assert.equal(hash(traced.result), expected);
      const totals: number[] = [],
        longest: number[] = [],
        elapsed: number[] = [],
        counts: number[] = [];
      let cpuMicros = 0;
      for (let i = 0; i < context.runs; i++) {
        const cpu = process.cpuUsage(),
          start = performance.now();
        const measured = await run(false);
        elapsed.push(performance.now() - start);
        const used = process.cpuUsage(cpu);
        cpuMicros += used.user + used.system;
        totals.push(measured.tasks.reduce((a, b) => a + b, 0));
        longest.push(Math.max(...measured.tasks));
        counts.push(measured.tasks.length);
        assert.equal(hash(measured.result), expected);
      }
      return [
        {
          read: "dailyArtistThenGenre",
          ...percentiles(elapsed),
          cpuMs: Number((cpuMicros / 1000 / context.runs).toFixed(3)),
          rowsRead: traced.rows,
          statements: traced.statements,
          notifications: 0,
          longestSyncTaskMs: Number(Math.max(...longest).toFixed(3)),
          resultKey: expected,
          details: {
            synchronousTotalMs: percentiles(totals),
            longestTaskMs: percentiles(longest),
            steps: counts,
            maxRowsPerStatement: traced.maxPage,
            source:
              "selected-revision LibraryStore + Core; production input/graph/catalog adapters and CPU step runner after; historical source algorithms/yield boundaries before",
            semanticEquality:
              "complete saved Artist and Genre mixes, seeds, familiar shares, order, build time, variety and every seed/variety random draw",
            omitted:
              "React/KV persistence, scheduler waits, network/harvest and taste derivation (#593); identical null taste, 1200 saved catalog candidates, no offline similar fallback needed with 20 played artists",
          },
        },
      ];
    } finally {
      Date.now = oldNow;
    }
  },
};
