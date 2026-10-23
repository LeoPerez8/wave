/** Faithful selected-revision read replay; neither native spring latency nor React paint. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import type * as Core from "@wave/core";
import type { SongRow } from "../../../src/library/LibraryStore.ts";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { loadLibraryStore } from "../store.ts";
import type { FastAgainBench } from "../types.ts";

const key = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonical = (track: SongRow | null) =>
  track === null
    ? null
    : Object.fromEntries(
        Object.entries({ ...track, explicit: track.explicit ?? "unknown" }).toSorted(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
const stages = ["springStart", "opening", "settled"] as const;

export const bench: FastAgainBench = {
  name: "nowPlayingOpen",
  async run(context) {
    const source = "apps/mobile/src/nowPlaying/SongButtons.tsx";
    if (!existsSync(resolve(context.root, source)))
      return ["Cold", "Warm"].flatMap((cache) =>
        stages.map((stage) => ({
          read: `${stage}${cache}`,
          status: "unavailable" as const,
          reason:
            "This revision predates streamed Now Playing controls; no invented reference replay.",
        })),
      );
    const store = await loadLibraryStore(context.root, context.fixture.db);
    const core = await context.loadModule<typeof Core>("packages/core/src/index.ts");
    const fixed = typeof store.nowPlayingSong === "function";
    const row = Effect.runSync(store.listSongs).find(
      (song) => song.id === context.fixture.songIds[19],
    )!;
    const song: Core.YtSong = {
      videoId: "now-playing-bench",
      title: row.title,
      artists: [row.artist],
      durationMs: row.durationMs,
      album: row.album,
      artworkUrl: null,
      explicit: false,
    };
    const target = { trackId: `yt:${song.videoId}`, song };
    const provenance = [
      source,
      "apps/mobile/src/nowPlaying/PlayerView.tsx",
      "apps/mobile/src/nowPlaying/hooks.ts",
      "apps/mobile/src/nowPlaying/sheet.ts",
      "apps/mobile/src/ytmusic/libraryFinder.ts",
    ].map((file) => ({
      file,
      sha256: createHash("sha256")
        .update(readFileSync(resolve(context.root, file)))
        .digest("hex"),
    }));
    const legacy = () => {
      const find = core.libraryFinder(Effect.runSync(store.listSongs));
      const ids = new Set(Effect.runSync(store.favoriteTrackIds));
      const pending = new Set(
        Effect.runSync(store.listPendingFavorites).map((pendingSong) => pendingSong.videoId),
      );
      const track = find(song);
      return {
        track: canonical(track),
        favorite: track !== null && ids.has(track.id),
        pendingFavorite: pending.has(song.videoId),
      };
    };
    const targeted = () => {
      const answer = Effect.runSync(store.nowPlayingSong(target));
      return { ...answer, track: canonical(answer.track) };
    };
    // Fixture and cache preparation are outside all measurements. A warm shared
    // query includes the lazy finder's first use, which the star already made.
    const warm = legacy();
    const measurements = [];
    for (const cache of ["Cold", "Warm"] as const) {
      const spring = () => core.stepNowPlayingSheet("hidden", { type: "tap" });
      const open = () => {
        const motion = spring();
        if (motion.spring !== "rise") throw new Error("opening did not start its spring");
        // Both selected sheet.ts versions assign the spring before notifying followers.
        if (!fixed && cache === "Cold") legacy();
        return {
          title: song.title,
          artist: row.artist,
          album: row.album,
          spring: motion.spring,
          shown: motion.phase !== "hidden",
        };
      };
      const openingQueries = traceQueries(context.fixture.db, open).queries;
      const settled = fixed ? targeted : () => warm;
      const settledQueries = traceQueries(context.fixture.db, settled).queries;
      const details = {
        cache: cache.toLowerCase(),
        source:
          "faithful replay of selected-worktree NowPlaying followers using its actual LibraryStore and Core",
        scope:
          "songs query, lazy recording finder, library and pending stars; metadata/artwork supplied by the player item; no network",
        spring:
          "sheet.ts assigns withSpring before phase listeners in ti and after; springStart measures the Core decision/handoff boundary, never native motion/paint",
        eagerMount:
          "ti's star can also acquire the finder while the sheet is hidden; Cold resets this shared state at the measured opening boundary",
        queryWarmth:
          "warm means shared songs, finder, favorite ids and pending stars already acquired before opening; after still uses its independent targeted answer",
        openingReads: openingQueries,
        settledReads: settledQueries,
        provenance,
        omitted:
          "React commits, Reanimated/native scheduling, animation duration, phone/Hermes latency",
      };
      measurements.push(
        context.measure(`springStart${cache}`, spring, {
          resultKey: (result) => key({ spring: result.spring, shown: result.phase !== "hidden" }),
          details,
        }),
      );
      measurements.push(context.measure(`opening${cache}`, open, { resultKey: key, details }));
      measurements.push(
        context.measure(`settled${cache}`, settled, {
          resultKey: key,
          details: {
            ...details,
            semanticEquality:
              "complete matched SongRow including identity/path plus saved library and pending star state; legacy absent explicit means unknown",
          },
        }),
      );
    }
    return measurements;
  },
};
