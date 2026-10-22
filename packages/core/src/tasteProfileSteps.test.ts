import assert from "node:assert/strict";
import test from "node:test";
import { tasteProfileSteps, magicArtistKey, type MagicSong } from "./index.ts";

test("taste derivation pauses between signals and keeps ti's full scores and insertion order", () => {
  const song: MagicSong = {
    trackId: "1",
    artists: [magicArtistKey("a"), magicArtistKey("a"), magicArtistKey("b")],
    genre: " Rock ",
    style: null,
  };
  let reads = 0;
  const steps = tasteProfileSteps(
    {
      plays: [
        { trackId: "gone", startedAt: 0, listenedMs: 1, endReason: "completed" },
        { trackId: "1", startedAt: 0, listenedMs: 1, endReason: "skipped" },
        { trackId: "1", startedAt: 0, listenedMs: 40000, endReason: "skipped" },
      ],
      favorites: [{ trackId: "1", changedAt: 0 }],
      downloads: [{ trackId: "1", downloadedAt: 0 }],
    },
    (id) => {
      reads++;
      return id === "1" ? song : undefined;
    },
    0,
  );
  assert.equal(reads, 0);
  assert.equal(steps.next().done, false);
  assert.equal(reads, 1);
  let result = steps.next();
  let turns = 1;
  while (!result.done) {
    turns++;
    result = steps.next();
  }
  assert.ok(turns >= 5);
  assert.deepEqual(result.value, {
    at: 0,
    songs: new Map([["1", 4]]),
    artists: new Map([
      ["a", 4],
      ["b", 4],
    ]),
    genres: new Map([["rock", 4]]),
  });
});
