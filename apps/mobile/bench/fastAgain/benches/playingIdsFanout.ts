import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import * as Effect from "effect/Effect";
import { sql } from "drizzle-orm";
import type { YtSong } from "@wave/core";
import { makeExternalStore } from "../../../src/lib/externalStore.ts";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { percentiles } from "../measure.ts";
import { loadLibraryStore } from "../store.ts";
import type { FastAgainBench } from "../types.ts";

const round = (n: number) => Number(n.toFixed(3));

/** Native React hooks are replayed through their actual registry, finder cache, bus and store. */
export const bench: FastAgainBench = {
  name: "playingIdsFanout",
  async run(context) {
    const current = existsSync(join(context.root, "apps/mobile/src/playback/playingIds.ts"));
    const hook = readFileSync(join(context.root, "apps/mobile/src/playback/hooks.ts"), "utf8");
    if (!hook.includes("useCurrentPlayingIds"))
      return [
        {
          read: "download/artist20",
          status: "unavailable",
          reason: "This revision predates the playing-ids hook",
        },
      ];
    if (!current) {
      assert.match(hook, /useLoadedLibraryFinder\(song !== null\)/);
      assert.match(hook, /playingTrackIds\(currentId, song, find/);
    }
    const core = await context.loadModule<typeof import("@wave/core")>(
      "packages/core/src/index.ts",
    );
    const bus = await context.loadModule<typeof import("../../../src/library/libraryChanges.ts")>(
      "apps/mobile/src/library/libraryChanges.ts",
    );
    const fixed = current
      ? await context.loadModule<typeof import("../../../src/playback/playingIds.ts")>(
          "apps/mobile/src/playback/playingIds.ts",
        )
      : null;
    const cacheModule = !current
      ? await context.loadModule<typeof import("../../../src/ytmusic/finderCache.ts")>(
          "apps/mobile/src/ytmusic/finderCache.ts",
        )
      : null;
    const store = await loadLibraryStore(context.root, context.fixture.db);
    const results = [];
    for (const [label, target] of [
      ["artist20", context.fixture.targets.small],
      ["artist300", context.fixture.targets.large],
    ] as const) {
      const row = Effect.runSync(store.songsWithIds([target.songIds[0]!]))[0]!;
      const song: YtSong = {
        videoId: "fanout-playing",
        title: "Fanout Déjà Vu",
        artists: [row.artist],
        durationMs: row.durationMs,
        album: row.album,
        artworkUrl: null,
        explicit: false,
      };
      const expected = [`yt:${song.videoId}`, String(row.id)].join(",");
      const writeTitle = (title: string) => {
        if (current)
          context.fixture.db.run(
            sql`UPDATE tracks SET title = ${title}, match_title = ${core.recordingMatchTitle(title)} WHERE id = ${row.id}`,
          );
        else context.fixture.db.run(sql`UPDATE tracks SET title = ${title} WHERE id = ${row.id}`);
      };
      const run = async (trace: boolean) => {
        writeTitle("Not downloaded yet");
        let rowsRead = 0,
          statements = 0,
          rereads = 0,
          finderRebuilds = 0,
          notifications = 0,
          sourceNotifications = 0;
        const steps: number[] = [];
        let readStarted: number | null = null;
        const sync = <A>(work: () => A): A => {
          const at = performance.now();
          try {
            return work();
          } finally {
            steps.push(performance.now() - at);
          }
        };
        const read = <A>(effect: Effect.Effect<A, unknown>): A =>
          sync(() => {
            readStarted = performance.now();
            rereads++;
            if (!trace) return Effect.runSync(effect);
            const measured = traceQueries(context.fixture.db, () => Effect.runSync(effect));
            rowsRead += measured.queries.reduce((n, q) => n + q.rows, 0);
            statements += measured.queries.length;
            return measured.result;
          });
        let complete!: () => void;
        let completed = new Promise<void>((resolve) => {
          complete = resolve;
        });
        const stops: (() => void)[] = [];
        let ids: readonly string[] = [];
        let flush: () => void;
        let measuring = false;
        if (fixed !== null) {
          let coldDone!: () => void;
          const cold = new Promise<void>((resolve) => {
            coldDone = resolve;
          });
          const targetStore = makeExternalStore({ id: `yt:${song.videoId}`, song });
          const playing = fixed.createPlayingIds({
            target: targetStore,
            read: async (playingSong) => {
              const result = read(store.matchingSong(playingSong));
              coldDone();
              return result;
            },
            onDownload: (listener) =>
              bus.onDownloadedRecording((recording) => {
                sourceNotifications++;
                listener(recording);
              }),
            onLibraryChange: bus.onLibraryChange,
          });
          for (let i = 0; i < 8; i++)
            stops.push(
              playing.subscribe(() => {
                notifications++;
                ids = [...playing.get()];
                if (notifications === 8) {
                  if (readStarted !== null) steps.push(performance.now() - readStarted);
                  complete();
                }
              }),
            );
          // The initial null lookup has no snapshot change: wait for its one actual read.
          await cold;
          flush = () =>
            bus.publishDownloadedRecording({
              title: song.title,
              artist: row.artist,
              durationMs: row.durationMs,
            });
        } else {
          let clock = 0;
          const finders = cacheModule!.makeFinderCache<
            import("../../../src/library/LibraryStore.ts").SongRow,
            (song: YtSong) => typeof row | null
          >({
            version: () => 0,
            read: async () => read(store.listSongs),
            build: (rows) => {
              let built: ((song: YtSong) => typeof row | null) | null = null;
              return (playingSong) => {
                if (built === null) {
                  finderRebuilds++;
                  built = core.libraryFinder(rows);
                }
                return built(playingSong);
              };
            },
          });
          const registry = core.createLibraryQueries<readonly (typeof row)[]>({
            now: () => clock,
            schedule: (ms, task) => {
              const timer = setTimeout(task, ms);
              return () => clearTimeout(timer);
            },
            read: (_key, settle) => {
              setTimeout(() => {
                settle({ ok: true, value: read(store.listSongs) });
              }, 0);
            },
            limits: { retainMs: 0, maxRetained: 0 },
          });
          for (let i = 0; i < 8; i++) {
            // Five warmed tabs, two covered pushed screens, one visible pushed screen.
            const attached = registry.attach(
              "songs",
              { tracks: true },
              {
                visible: i === 7,
                onChange: () => {
                  sync(() => {
                    notifications++;
                    const rows = registry.current("songs")!.value;
                    ids = core.playingTrackIds(`yt:${song.videoId}`, song, finders.over(rows));
                  });
                  if (readStarted !== null) steps.push(performance.now() - readStarted);
                  if (notifications === 8 || (measuring && notifications === 1)) complete();
                },
              },
            );
            stops.push(attached.detach);
          }
          stops.push(
            bus.onLibraryChange((change) => {
              sourceNotifications++;
              registry.change(change);
            }),
          );
          await completed;
          // Mature ti's 1.5 s burst throttle without timing an intentional wait.
          clock = 2000;
          flush = () => bus.publishLibraryChange({ kind: "tracks", ids: [row.id], burst: true });
        }
        completed = new Promise<void>((resolve) => {
          complete = resolve;
        });
        rowsRead = statements = rereads = finderRebuilds = notifications = sourceNotifications = 0;
        steps.length = 0;
        writeTitle(song.title); // Completion's SQL write is outside the measured subscriber work.
        const cpu = process.cpuUsage(),
          at = performance.now();
        measuring = true;
        sync(flush);
        await completed;
        const wallMs = performance.now() - at,
          used = process.cpuUsage(cpu);
        assert.equal(ids.join(","), expected);
        stops.forEach((stop) => stop());
        return {
          rowsRead,
          statements,
          rereads,
          finderRebuilds,
          notifications,
          sourceNotifications,
          wallMs,
          cpuMs: (used.user + used.system) / 1000,
          longest: Math.max(...steps),
          resultKey: ids.join(","),
        };
      };
      try {
        await run(false);
        const traced = await run(true),
          samples = [];
        for (let i = 0; i < context.runs; i++) samples.push(await run(false));
        results.push({
          read: `download/${label}`,
          ...percentiles(samples.map((s) => s.wallMs)),
          cpuMs: round(samples.reduce((n, s) => n + s.cpuMs, 0) / samples.length),
          rowsRead: traced.rowsRead,
          statements: traced.statements,
          notifications: traced.notifications,
          longestSyncTaskMs: round(Math.max(...samples.map((s) => s.longest))),
          resultKey: traced.resultKey,
          details: {
            sourceSubscribersRefreshed: traced.sourceNotifications,
            consumersNotified: traced.notifications,
            rereads: traced.rereads,
            wholeLibraryRereads: current ? 0 : traced.rereads,
            finderRebuilds: traced.finderRebuilds,
            mountedConsumers: 8,
            visibleLegacyConsumers: 1,
            targetArtistSongs: target.songIds.length,
            source: current
              ? "production createPlayingIds + LibraryStore.matchingSong + download bus + Core registry"
              : "faithful ti hook replay: actual shared songs registry + makeFinderCache/finderOver + LibraryStore.listSongs + playingTrackIds + Library change bus",
            scope:
              "completion only; setup, SQL writes, cold reads excluded; ti burst throttle matured by virtual clock; longest task = max source event or read-through-last-notification segment, including registry settlement and snapshot processing; React commits/native frames not measured",
            semantics:
              "same streamed and local row identities after download; legacy hidden consumers catch up on show, current consumers receive changed snapshot immediately",
          },
        });
      } finally {
        writeTitle(row.title);
      }
    }
    return results;
  },
};
