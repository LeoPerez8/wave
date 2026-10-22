/** #592: faithful cold-Home read replay; JS boundaries, not a native renderer. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import * as Effect from "effect/Effect";
import type { DiscoverMixes } from "@wave/core";

import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { percentiles } from "../measure.ts";
import { loadLibraryStore } from "../store.ts";
import type { FastAgainBench } from "../types.ts";

const round = (value: number) => Number(value.toFixed(3));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const bench: FastAgainBench = {
  name: "homeOpening",
  async run(context) {
    const { fixture } = context;
    const store = await loadLibraryStore(context.root, fixture.db);
    if (store.homeAdded === undefined || store.knownVideos === undefined)
      return [
        {
          read: "coldLaunch",
          status: "unavailable",
          reason: "This revision predates the replayed Home queries",
        },
      ];
    const core = await context.loadModule<typeof import("@wave/core")>(
      "packages/core/src/index.ts",
    );
    const stats = await context.loadModule<typeof import("../../../src/stats/Stats.ts")>(
      "apps/mobile/src/stats/Stats.ts",
    );
    const modulePath = "apps/mobile/src/home/homeOpening.ts";
    const opening = existsSync(resolve(context.root, modulePath))
      ? await context.loadModule<typeof import("../../../src/home/homeOpening.ts")>(modulePath)
      : null;
    const savedMixes: DiscoverMixes[] = ["artist", "genre"].map((kind) => ({
      builtAt: fixture.now,
      playSeeds: true,
      mixes: Array.from({ length: 4 }, (_, mix) => ({
        id: `${kind}:${mix}`,
        seed: { kind: kind as "artist" | "genre", name: `Seed ${mix}` },
        songs: Array.from({ length: 50 }, (_, song) => ({
          videoId: `mix-${kind}-${mix}-${song}`,
          title: `New song ${song}`,
          artists: [`Seed ${mix}`],
          album: null,
          albumId: null,
          durationMs: 180_000,
          artworkUrl: null,
          explicit: false,
        })),
        familiar: [
          {
            source: "library",
            track: { id: fixture.songIds[1]!, title: "Known song", artist: `Seed ${mix}` },
          },
        ],
      })),
    }));
    const shownMixes = (saved: DiscoverMixes, videos: readonly string[]) => {
      const section = core.discoverMixesSection(saved, {
        ytMusic: true,
        nothingToBuildFrom: false,
        blend: {
          level: 3,
          keep: core.discoverMixKeep({
            dontPlayExplicit: false,
            library: null,
            knownVideos: new Set(videos),
          }),
        },
      });
      assert.equal(section.kind, "mixes");
      return section.kind === "mixes"
        ? section.mixes.map((mix) => ({ ...mix, caption: core.discoverMixCaption(mix) }))
        : [];
    };
    // Saved choices are setup, outside measurement. No day's build is due in this case.
    const toMagic = core.magicLibrarySongs(Effect.runSync(store.listArtists));
    const magic = Effect.runSync(store.listSongs)
      .filter((song) => song.path !== null)
      .map(toMagic);
    const picks = core.magicQueuePicks(null, magic, {
      now: fixture.now,
      taste: null,
      random: () => 0.5,
    });
    assert.equal(core.magicQueuePicksDue(picks, magic, fixture.now), false);

    const steps: readonly [string, () => unknown][] = [
      ["homeAdded", () => Effect.runSync(store.homeAdded)],
      ["homePlays", () => Effect.runSync(store.homePlays)],
      ["homeFavorites", () => Effect.runSync(store.homeFavorites)],
      // The remaining Home readers are intentionally included, not attributed to this ticket's fix.
      [
        "recapAvailability",
        () => core.availableRecaps(Effect.runSync(store.countedListening), fixture.now),
      ],
      [
        "mostPlayedOfAllTime",
        () => Effect.runSync(stats.topAlbumsAndArtists(store, "all", core.STATS_TOP, 5)),
      ],
      ["libraryCounts", () => Effect.runSync(store.countLibrary)],
      ["listeningSums", () => Effect.runSync(store.listeningSums)],
      [
        "magicQueueLibraryAndDueCheck",
        () => {
          const songs = Effect.runSync(store.listSongs).filter((song) => song.path !== null);
          const convert = core.magicLibrarySongs(Effect.runSync(store.listArtists));
          const library = {
            songs: new Map(songs.map((song) => [String(song.id), song])),
            magic: songs.map(convert),
          };
          assert.equal(core.magicQueuePicksDue(picks, library.magic, fixture.now), false);
          return picks.trackIds.map((id) => library.songs.get(id)?.id);
        },
      ],
      [
        "mixFocusKnownVideosAndDueChecks",
        () => {
          // Both useDiscoverMixes focus callbacks read knownVideos in ti/current source.
          return savedMixes.map((saved) => {
            const videos = Effect.runSync(store.knownVideos);
            assert.equal(core.discoverMixesDue(saved, { now: fixture.now, played: true }), false);
            return { videos, mixes: shownMixes(saved, videos) };
          });
        },
      ],
    ];
    const oldNow = Date.now;
    Date.now = () => fixture.now;
    try {
      const replay = async (trace: boolean) => {
        const results: unknown[] = [];
        const durations: number[] = [];
        const work: { read: string; rowsRead: number; statements: number }[] = [];
        for (const [read, run] of steps) {
          // Separate scheduled Library reads yield to the event loop, as the app's timer adapter does.
          await setImmediate();
          const start = performance.now();
          if (trace) {
            const measured = traceQueries(fixture.db, run);
            results.push(measured.result);
            work.push({
              read,
              rowsRead: measured.queries.reduce((sum, q) => sum + q.rows, 0),
              statements: measured.queries.length,
            });
          } else results.push(run());
          durations.push(performance.now() - start);
        }
        return { results, durations, work };
      };
      const traced = await replay(true);
      const expected = hash(traced.results);
      const totals: number[] = [];
      const elapsed: number[] = [];
      const tasks: number[][] = steps.map(() => []);
      let cpuMicros = 0;
      for (let i = 0; i < context.runs; i++) {
        const cpu = process.cpuUsage();
        const start = performance.now();
        const run = await replay(false);
        elapsed.push(performance.now() - start);
        const used = process.cpuUsage(cpu);
        cpuMicros += used.user + used.system;
        totals.push(run.durations.reduce((sum, ms) => sum + ms, 0));
        run.durations.forEach((ms, index) => tasks[index]!.push(ms));
        assert.equal(hash(run.results), expected);
      }
      // Exercise the production time boundary as well: even its first rAF starts no read.
      if (opening !== null) {
        const frames: (() => void)[] = [];
        let started = false;
        const first = traceQueries(fixture.db, () => {
          opening.afterHomeFrame(
            () => {
              started = true;
            },
            { request: (run) => frames.push(run), cancel: () => {} },
          );
          frames.shift()!();
        });
        assert.equal(started, false);
        assert.equal(first.queries.length, 0);
        frames.shift()!();
        assert.equal(started, true);
      }
      return [
        {
          read: "coldLaunch",
          ...percentiles(totals),
          cpuMs: round(cpuMicros / 1000 / context.runs),
          rowsRead: traced.work.reduce((sum, step) => sum + step.rowsRead, 0),
          statements: traced.work.reduce((sum, step) => sum + step.statements, 0),
          longestSyncTaskMs: round(Math.max(...tasks.flat())),
          notifications: 0,
          resultKey: expected,
          details: {
            source:
              "faithful replay of selected-worktree LibraryStore + Stats + Core; saved picks/mixes standing; YT Music enabled, offline harvest",
            semanticEquality:
              "complete local slice payloads, recap availability, album/artist rankings, overview inputs, nine pick ids, both known-video answers and eight blended mix payloads/captions",
            firstFrameWaitsFor: opening === null ? ["homeAdded", "homePlays", "homeFavorites"] : [],
            firstFrameRowsRead:
              opening === null
                ? traced.work.slice(0, 3).reduce((sum, step) => sum + step.rowsRead, 0)
                : 0,
            firstFrameStatements:
              opening === null
                ? traced.work.slice(0, 3).reduce((sum, step) => sum + step.statements, 0)
                : 0,
            firstContentWaitsFor:
              opening === null ? "all three local slices" : "only the section's own slice",
            firstFrameBoundary:
              "first section-bearing frame's data dependencies, not the earlier title-only frame; no native paint measurement",
            totalSynchronousJsMs: percentiles(totals),
            elapsedReplayMs: percentiles(elapsed),
            untilSettled:
              "all mounted cold-Home readers replayed conservatively, including ancillary readers; excludes scheduler/animation waits",
            steps: traced.work.map((work, index) => ({
              ...work,
              ...percentiles(tasks[index]!),
              longestSyncTaskMs: round(Math.max(...tasks[index]!)),
            })),
            readsAfterSettled: [],
            omitted:
              "React/render/layout/native paint, KV-setting reads, network and startup jobs; taste derivation and mix builds are not due with standing saved choices; selected-worktree modules/SQLite are warmed, cold refers to screen query/pick caches",
            notificationsScope:
              "read-only replay has no subscribed store writes; not a React commit counter",
            followups:
              "#593/#594 own targeted picks, versioned knownVideos, first-of-day/return and stepped builds",
          },
        },
      ];
    } finally {
      Date.now = oldNow;
    }
  },
};
