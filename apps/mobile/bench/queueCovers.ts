/**
 * Replays YT Music covers landing in a queue of 500, 2,000 and 5,000 songs
 * (#305), as `cacheYtCoversLater` takes them after a play has started, and
 * counts what the queue's tracks store does with them: changes subscribers
 * hear (each one re-renders Up Next's visible rows), entries copied into new
 * maps, the replay's time and the longest the event loop was held. Checks
 * that every song ends with its cached artwork, thumbnail and palette.
 *
 * - `burst`: every cover is already cached, so all land at once (the audit's
 *   replay, `notes/audit-20261016/measure.mjs`).
 * - `paced`: covers land a pair per 16 ms tick, as a slow network would bring
 *   them (500 songs only: the timers make it slow).
 *
 * Desktop numbers: Node, no React, no I/O. They compare the store's work
 * before and after; they don't predict frames on the phone. Run from the
 * repo root, optionally against another copy of the module (the code before):
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/queueCovers.ts [path/to/queueTracks.ts]
 */
import type { YtSong } from "@wave/core";
import * as Effect from "effect/Effect";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

type Module = typeof import("../src/playback/queueTracks.ts");

const target = process.argv[2];
const { cacheYtCoversLater, learnQueueTracks, queueTracks, toYtQueueTrack }: Module = await import(
  target === undefined ? "../src/playback/queueTracks.ts" : pathToFileURL(target).href
);

const songsOf = (size: number): YtSong[] =>
  Array.from({ length: size }, (_, i) => ({
    videoId: String(i).padStart(11, "0"),
    title: `Track ${i}`,
    artists: ["Artist"],
    album: null,
    durationMs: 180_000,
    artworkUrl: `https://fixture.invalid/${i}`,
    explicit: false,
  }));

const cached = (url: string) => ({
  path: `${url}.jpg`,
  thumbPath: `${url}.thumb.jpg`,
  palette: { dominant: "#203040" },
});

/** A clock that lets the covers waiting on it land, a pair per tick. */
const ticker = () => {
  let release: () => void = () => {};
  let tick = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timer = setInterval(() => {
    const done = release;
    tick = new Promise<void>((resolve) => {
      release = resolve;
    });
    done();
  }, 16);
  return { next: () => tick, stop: () => clearInterval(timer) };
};

/**
 * The longest the event loop went without running a timer (what a frame
 * callback or a touch would have waited for), from now until `stop`.
 */
const longestHold = () => {
  let last = performance.now();
  let most = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    most = Math.max(most, now - last);
    last = now;
  }, 1);
  return {
    stop: async (): Promise<number> => {
      // One more turn, to see a hold that lasted until the replay ended.
      await new Promise((resolve) => setTimeout(resolve, 5));
      clearInterval(timer);
      return most;
    },
  };
};

const replay = async (mode: "burst" | "paced", size: number) => {
  const songs = songsOf(size);
  learnQueueTracks(
    songs.map((song) => toYtQueueTrack(song, null)),
    { forgetOthers: true },
  );
  let changes = 0;
  let copied = 0;
  const stop = queueTracks.subscribe(() => {
    changes += 1;
    copied += queueTracks.get().size;
  });
  const clock = mode === "paced" ? ticker() : null;
  const cache = (url: string) =>
    clock === null
      ? Effect.succeed(cached(url))
      : Effect.promise(clock.next).pipe(Effect.as(cached(url)));
  const held = longestHold();
  const before = performance.now();
  await Effect.runPromise(cacheYtCoversLater(songs, cache));
  const ms = performance.now() - before;
  const maxHeldMs = await held.stop();
  clock?.stop();
  stop();
  for (const song of songs) {
    const track = queueTracks.get().get(`yt:${song.videoId}`);
    assert.equal(track?.artworkPath, `${song.artworkUrl}.jpg`);
    assert.equal(track?.thumbPath, `${song.artworkUrl}.thumb.jpg`);
    assert.deepEqual(track?.palette, { dominant: "#203040" });
  }
  console.log(
    JSON.stringify({
      mode,
      size,
      changes,
      copiedEntries: copied,
      ms: Math.round(ms * 100) / 100,
      maxHeldMs: Math.round(maxHeldMs * 100) / 100,
    }),
  );
};

console.log(
  JSON.stringify({
    module: target ?? "src/playback/queueTracks.ts",
    runtime: process.version,
    note: "Desktop Node; no React rendering, no I/O. Not Android frame timings.",
  }),
);
for (const size of [500, 2000, 5000]) await replay("burst", size);
await replay("paced", 500);
