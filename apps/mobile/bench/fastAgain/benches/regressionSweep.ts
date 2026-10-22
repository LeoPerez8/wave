/** #596 characterization only: selected worktree modules, no production changes. */
import * as Effect from "effect/Effect";
import { createHash } from "node:crypto";

import { loadLibraryStore } from "../store.ts";
import type { BenchMeasurement, FastAgainBench } from "../types.ts";

const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const bench: FastAgainBench = {
  name: "regressionSweep",
  async run(context) {
    const { fixture, loadModule, measure } = context;
    const store = await loadLibraryStore(context.root, fixture.db);
    const statsModule = await loadModule<typeof import("../../../src/stats/Stats.ts")>(
      "apps/mobile/src/stats/Stats.ts",
    );
    const storeModule = await loadModule<typeof import("../../../src/library/LibraryStore.ts")>(
      "apps/mobile/src/library/LibraryStore.ts",
    );
    const core = await loadModule<typeof import("@wave/core")>("packages/core/src/index.ts");
    const stats = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* statsModule.Stats;
      }).pipe(
        Effect.provide(statsModule.layer),
        Effect.provideService(storeModule.LibraryStore, store),
      ),
    );
    const measurements: BenchMeasurement[] = [];
    // Fix the calendar boundary for actual Stats.recaps as well as pure controls.
    const now = Date.now;
    Date.now = () => fixture.now;
    try {
      if (stats.recaps === undefined) {
        measurements.push({
          read: "homeRecapAvailability",
          status: "unavailable",
          reason: "Home's Recap announcement and Stats.recaps did not exist in this revision",
        });
      } else {
        measurements.push(
          measure("homeRecapAvailability", () => Effect.runSync(stats.recaps), {
            resultKey: hash,
            details: {
              source: "actual Stats.recaps + LibraryStore.countedListening + availableRecaps",
              trigger: "useRecapToAnnounce -> useStatsRead, every Home focus / focused play change",
              phase: "focus read, independent of shared Home shelves and first-content scheduler",
            },
          }),
        );
      }
      if (store.playlistRecommendationInput === undefined) {
        for (const read of [
          "playlistRecommendationInput",
          "playlistRankWarmInput",
          "playlistGraphCold",
        ])
          measurements.push({
            read,
            status: "unavailable",
            reason: "Playlist recommendations did not exist",
          });
      } else {
        const input = Effect.runSync(store.playlistRecommendationInput(fixture.playlistId));
        measurements.push(
          measure(
            "playlistRecommendationInput",
            () => Effect.runSync(store.playlistRecommendationInput(fixture.playlistId)),
            {
              resultKey: (value) =>
                hash({
                  playlist: value.playlist.map((song) => song.id),
                  library: value.library.map((song) => song.id),
                  catalog: value.catalog,
                }),
              details: {
                source: "actual LibraryStore.playlistRecommendationInput",
                trigger:
                  "playlist mount; every tracks/favorites or matching playlist change, even hidden",
                playlistSongs: input.playlist.length,
              },
            },
          ),
          measure(
            "playlistRankWarmInput",
            () =>
              core.playlistRecommendations(input.playlist, {
                ...input,
                graph: null,
                now: fixture.now,
                online: false,
                ytMusicEnabled: false,
              }),
            {
              resultKey: (value) =>
                hash(value.map((offer) => ({ id: offer.track.id, score: offer.score }))),
              details: {
                source: "actual Core.playlistRecommendations, preloaded inputs and warm/null graph",
                phase: "synchronous ranking after input Promise; excludes DB and graph",
              },
            },
          ),
        );
        const graphModule = await loadModule<typeof import("../../../src/home/artistGraph.ts")>(
          "apps/mobile/src/home/artistGraph.ts",
        );
        measurements.push(
          measure("playlistGraphCold", () => Effect.runSync(graphModule.readArtistGraph(store)), {
            resultKey: (value) => hash([...value.edges].map(([key, edges]) => [key, [...edges]])),
            details: {
              source: "actual readArtistGraph, default no-op between steps",
              phase:
                "cold graph total synchronous CPU probe; production freeTurnEffect yields at two boundaries",
              caveat:
                "longestSyncTaskMs here is the unsliced probe, not production's longest graph task",
            },
          }),
        );
      }
      // Controls establish which costs predate the regression and whether narrow reads suffice.
      for (const [read, effect] of [
        ["artistOwnRows20", store.getArtist(fixture.targets.small.artistId)],
        ["albumOwnRows10", store.getAlbum(fixture.albumId)],
        ["genreOwnRows", store.getGenre(fixture.genreId)],
        ["artistPage50", store.listArtistsPage({ offset: 0, limit: 50 })],
        [
          "artistRows2",
          store.artistsByIds([fixture.targets.small.artistId, fixture.targets.large.artistId]),
        ],
        ["fullSongs", store.listSongs],
        ["songRows50", store.songsWithIds(fixture.songIds.slice(0, 50))],
      ] as const) {
        measurements.push(
          measure(read, () => Effect.runSync(effect as Effect.Effect<unknown, unknown>), {
            details: { source: "actual LibraryStore control; no route/frame simulation" },
          }),
        );
      }
      return measurements;
    } finally {
      Date.now = now;
    }
  },
};
