/** #592: faithful cold-Home read replay; JS boundaries, not a native renderer. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import * as Effect from "effect/Effect";
import type { DiscoverMixes, MagicSong, TasteProfile } from "@wave/core";

import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { startupReplay } from "../startupReplay.ts";
import { measureCooperative } from "../cooperative.ts";
import { profileKey } from "./tasteProfile.ts";
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
    const readsPath = "apps/mobile/src/home/magicQueueRead.ts";
    const reads = existsSync(resolve(context.root, readsPath))
      ? await context.loadModule<typeof import("../../../src/home/magicQueueRead.ts")>(readsPath)
      : null;
    const jobPath = "apps/mobile/src/home/magicQueueJob.ts";
    const job = existsSync(resolve(context.root, jobPath))
      ? await context.loadModule<typeof import("../../../src/home/magicQueueJob.ts")>(jobPath)
      : null;
    const derivation =
      job === null
        ? null
        : await context.loadModule<typeof import("../../../src/playback/tasteDerivation.ts")>(
            "apps/mobile/src/playback/tasteDerivation.ts",
          );
    const savedMixes: DiscoverMixes[] = ["artist", "genre"].map((kind) => ({
      builtAt: fixture.now,
      playSeeds: true,
      mixes: Array.from({ length: 4 }, (_, mix) => ({
        id: `${kind}:${mix}`,
        seed: { kind: kind as "artist" | "genre", name: `Seed ${mix}` },
        songs: Array.from({ length: 50 }, (_entry, song) => ({
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

    let displayedPicks = picks;
    let dueLibrary: readonly MagicSong[] = [];
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
          if (reads !== null) {
            return Effect.runSync(reads.magicQueueRead(displayedPicks.trackIds).read(store)).map(
              (song) => song.id,
            );
          }
          const songs = Effect.runSync(store.listSongs).filter((song) => song.path !== null);
          const convert = core.magicLibrarySongs(Effect.runSync(store.listArtists));
          const library = {
            songs: new Map(songs.map((song) => [String(song.id), song])),
            magic: songs.map(convert),
          };
          dueLibrary = library.magic;
          assert.equal(
            core.magicQueuePicksDue(displayedPicks, library.magic, fixture.now),
            displayedPicks !== picks,
          );
          return displayedPicks.trackIds.map((id) => library.songs.get(id)?.id);
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
    const startup = await startupReplay(context, store);
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
        // Measure complete JS tasks between actual injected free turns, including the last task.
        const startupTasks: number[] = [];
        let started: number | undefined;
        const end = () => {
          if (started !== undefined) startupTasks.push(performance.now() - started);
          started = undefined;
        };
        const turn = Effect.suspend(() => {
          end();
          return Effect.promise(() => setImmediate()).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                started = performance.now();
              }),
            ),
          );
        });
        if (trace) {
          const measured = traceQueries(fixture.db, () => Effect.runSync(startup.run(Effect.void)));
          results.push(measured.result);
          work.push({
            read: "startupScanImportsYtResumeDuplicates",
            rowsRead: measured.queries.reduce((sum, query) => sum + query.rows, 0),
            statements: measured.queries.length,
          });
        } else {
          results.push(await Effect.runPromise(startup.run(turn)));
          end();
        }
        durations.push(startupTasks.reduce((sum, ms) => sum + ms, 0));
        return { results, durations, work, startupTasks };
      };
      startup.reset();
      const traced = await replay(true);
      const expected = hash(traced.results);
      const totals: number[] = [];
      const elapsed: number[] = [];
      const tasks: number[][] = [...steps.map(() => [] as number[]), [] as number[]];
      const startupLongest: number[] = [];
      const startupCounts: number[] = [];
      let cpuMicros = 0;
      for (let i = 0; i < context.runs; i++) {
        startup.reset();
        const cpu = process.cpuUsage();
        const start = performance.now();
        const run = await replay(false);
        elapsed.push(performance.now() - start);
        const used = process.cpuUsage(cpu);
        cpuMicros += used.user + used.system;
        totals.push(run.durations.reduce((sum, ms) => sum + ms, 0));
        run.durations.forEach((ms, index) => tasks[index]!.push(ms));
        startupLongest.push(Math.max(0, ...run.startupTasks));
        startupCounts.push(run.startupTasks.length);
        assert.deepEqual(run.results, traced.results);
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
      const coldLaunch = {
        read: "coldLaunch",
        ...percentiles(totals),
        cpuMs: round(cpuMicros / 1000 / context.runs),
        rowsRead: traced.work.reduce((sum, step) => sum + step.rowsRead, 0),
        statements: traced.work.reduce((sum, step) => sum + step.statements, 0),
        longestSyncTaskMs: round(
          Math.max(...tasks.slice(0, steps.length).flat(), ...startupLongest),
        ),
        notifications: 0,
        resultKey: expected,
        details: {
          source:
            "faithful replay of selected-worktree LibraryStore + Stats + Core + targeted pick descriptor when present; saved picks/mixes standing; YT Music enabled, offline harvest",
          semanticEquality:
            "complete local slice payloads, recap availability, album/artist rankings, overview inputs, nine pick ids, both known-video answers, eight blended mix payloads/captions and startup read/import/pause/duplicate results",
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
          openingReaderSynchronousJsMs: percentiles(
            totals.map((total, i) => total - tasks[steps.length]![i]!),
          ),
          elapsedReplayMs: percentiles(elapsed),
          untilSettled:
            "all mounted cold-Home readers conservatively define the opening horizon; startup follows settlement only in production after variant; full total includes startup completion; scheduler/animation waits excluded",
          steps: traced.work.map((work, index) => ({
            ...work,
            ...percentiles(tasks[index]!),
            longestSyncTaskMs: round(
              Math.max(...(index === steps.length ? startupLongest : tasks[index]!)),
            ),
          })),
          readsAfterSettled: startup.stepped ? ["startupScanImportsYtResumeDuplicates"] : [],
          startup: {
            release: startup.stepped
              ? "after global WaveTiming settlement and three quiet frame intervals"
              : "after first content; no settlement gate (ti)",
            order: [
              "scan",
              "link imports",
              "YT library import resume",
              "replacement check after scan",
            ],
            tasks: startupCounts,
            longestTaskSamplesMs: startupLongest.map(round),
            totalSynchronousJsMs: percentiles(tasks[steps.length]!),
            source:
              "selected-worktree startupJobs when present, otherwise faithful replay of ti LibraryScan/playlistImports/ytLibraryImport/replacementDuplicates using selected store/Core",
            scenario:
              "unchanged incremental scan, one retained 20-song Spotify link import, one kept YT library source paused offline, due replacement check with zero pairs; source reads and pairing still scale with the Library",
            omissions:
              "native filesystem discovery/audio decoding, KV JSON load/save, UI notifications and Android services; native scanner emits no changed/missing files; no network request; modules warmed",
          },
          omitted:
            "React/render/layout/native paint, KV-setting reads, network; taste derivation and mix builds are not due with standing saved choices; selected-worktree modules/SQLite are warmed, cold refers to screen query/pick caches",
          notificationsScope:
            "read-only replay has no subscribed store writes; not a React commit counter",
          followups:
            "#594 owns versioned knownVideos, return and stepped mix builds; #598 owns Recap availability",
        },
      };
      displayedPicks = { ...picks, day: "yesterday" };
      const firstDay = await measureCooperative(
        fixture.db,
        "firstHomeOfDay",
        context.runs,
        (turn) =>
          Effect.gen(function* () {
            const visible: unknown[] = [];
            for (const [, run] of steps) {
              yield* turn;
              visible.push(yield* Effect.sync(run));
            }
            let profile: TasteProfile | null = null;
            if (job !== null && derivation !== null && reads !== null) {
              const picked = yield* job.buildHomeMagicQueue(store, displayedPicks, {
                now: fixture.now,
                random: core.seededRandom("home-first-day"),
                turn,
                taste: (library) =>
                  derivation.deriveTaste(store, turn, fixture.now, library).pipe(
                    Effect.tap((value) =>
                      Effect.sync(() => {
                        profile = value;
                      }),
                    ),
                  ),
              });
              yield* turn;
              const updated = yield* reads.magicQueueRead(picked.trackIds).read(store);
              return {
                visible,
                profile: profileKey(profile!),
                picks: picked,
                updated: updated.map((song) => song.id),
              };
            }
            // ti's focus update reuses the row's full map, then rereads Library for TasteProfile.live.
            yield* turn;
            const history = yield* store.tasteHistory;
            const songs = yield* store.listSongs;
            const convert = core.magicLibrarySongs(yield* store.listArtists);
            const byId = new Map(songs.map((song) => [String(song.id), convert(song)]));
            profile = core.tasteProfile(history, (id) => byId.get(id), fixture.now);
            const picked = core.magicQueuePicks(displayedPicks, dueLibrary, {
              now: fixture.now,
              taste: profile,
              random: core.seededRandom("home-first-day"),
            });
            return {
              visible,
              profile: profileKey(profile),
              picks: picked,
              updated: picked.trackIds.map(Number),
            };
          }),
        hash,
      );
      const firstDayDetails = {
        ...firstDay.details,
        scenario:
          "first Home of day, yesterday's nine picks remain through all opening reads and due work; first live profile request; saved mixes still standing (mix build is #594)",
        settlement:
          "all opening reads finish before due work starts; conservative desktop replay, not native WaveTiming/frame measurement",
        semanticEquality:
          "all cold-Home payloads plus exact complete taste scores, all pick metadata and ordered replacement rows",
      };
      return [coldLaunch, { ...firstDay, details: firstDayDetails }];
    } finally {
      Date.now = oldNow;
    }
  },
};
