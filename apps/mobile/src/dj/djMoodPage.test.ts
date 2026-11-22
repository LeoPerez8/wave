import assert from "node:assert/strict";
import test from "node:test";

import { djMoodPageWrites, type DjMoodPagePorts } from "./djMoodPage.ts";

const song = (videoId: string) => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  durationMs: 200_000,
});

const features = { energy: 0.7, valence: 0.6, acousticness: 0.2, mode: 1 };

const ports = (overrides: Partial<DjMoodPagePorts> = {}): DjMoodPagePorts => ({
  enabled: () => true,
  turn: async () => {},
  deezerIsrc: async ({ videoId }) => `USABC000000${videoId === "a" ? 1 : 2}`,
  searchFallback: async () => null,
  featureRows: async (ids) => ids.map((isrc) => ({ isrc, ...features })),
  now: () => 50,
  ...overrides,
});

test("every song of a page is saved: found, missed or failed", async () => {
  const writes = await djMoodPageWrites(
    { songs: [song("a"), song("b"), song("c")], unreadable: ["d"], last: "d" },
    ports({
      deezerIsrc: async ({ videoId }) => {
        if (videoId === "c") throw new Error("Deezer HTTP 503");
        return videoId === "a" ? "USABC0000001" : null;
      },
    }),
  );
  assert.deepEqual(writes, [
    { videoId: "a", isrc: "USABC0000001", features, checkedAt: 50 },
    { videoId: "b", isrc: null, features: null, checkedAt: 50 },
    { videoId: "c", isrc: null, features: null, checkedAt: 50, failed: true },
    { videoId: "d", isrc: null, features: null, checkedAt: 50 },
  ]);
});

test("an answer the page can't read fails the page's songs instead of leaving them due (#1449)", async () => {
  // Left unsaved, the songs came back on every pass the catalog started, about every 33 s.
  const writes = await djMoodPageWrites(
    { songs: [song("a"), song("b")], unreadable: [], last: "b" },
    ports({ featureRows: async () => [null as never] }),
  );
  assert.deepEqual(
    writes?.map(({ videoId, failed }) => ({ videoId, failed })),
    [
      { videoId: "a", failed: true },
      { videoId: "b", failed: true },
    ],
  );
});

test("a page the lookup stopped on (app left, offline) saves nothing", async () => {
  let on = true;
  const writes = await djMoodPageWrites(
    { songs: [song("a"), song("b")], unreadable: [], last: "b" },
    ports({
      enabled: () => on,
      deezerIsrc: async () => {
        on = false;
        return "USABC0000001";
      },
    }),
  );
  assert.equal(writes, null);
});

test("each song's Deezer read and fallback search waits for its own free turn", async () => {
  const turns: string[] = [];
  await djMoodPageWrites(
    { songs: [song("a"), song("b")], unreadable: [], last: "b" },
    ports({
      turn: async (step) => {
        turns.push(step);
      },
      deezerIsrc: async ({ videoId }) => (videoId === "a" ? "USABC0000001" : null),
    }),
  );
  assert.deepEqual(turns, ["ISRCs", "ISRCs", "search fallback"]);
});
