import assert from "node:assert/strict";
import test from "node:test";
import {
  magicArtistKey,
  seededRandom,
  tasteProfile,
  tasteProfileSteps,
  type MagicSong,
  type TasteHistory,
} from "./index.ts";

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

test("stepped taste equals ti's tasteProfile, decay and map order included, over a mixed history", () => {
  const random = seededRandom("history");
  const day = 86_400_000;
  const now = 400 * day;
  const songs = new Map<string, MagicSong>(
    Array.from({ length: 60 }, (_, i) => [
      String(i),
      {
        trackId: String(i),
        artists: [magicArtistKey("a" + (i % 7)), magicArtistKey("b" + (i % 3))],
        genre: i % 5 === 0 ? null : ["Rock", " pop", "Jazz "][i % 3]!,
        style: null,
      },
    ]),
  );
  const id = () => String(Math.floor(random() * 70));
  const history: TasteHistory = {
    plays: Array.from({ length: 500 }, () => ({
      trackId: id(),
      startedAt: Math.floor(random() * now),
      listenedMs: Math.floor(random() * 300_000),
      endReason: (["completed", "skipped", "interrupted", "stopped"] as const)[
        Math.floor(random() * 4)
      ]!,
    })),
    favorites: Array.from({ length: 20 }, () => ({ trackId: id(), changedAt: random() * now })),
    downloads: Array.from({ length: 20 }, () => ({ trackId: id(), downloadedAt: random() * now })),
  };
  const steps = tasteProfileSteps(history, (trackId) => songs.get(trackId), now);
  let result = steps.next();
  while (!result.done) result = steps.next();
  const expected = tasteProfile(history, (trackId) => songs.get(trackId), now);
  assert.deepEqual(result.value, expected);
  for (const key of ["songs", "artists", "genres"] as const)
    assert.deepEqual([...result.value[key].keys()], [...expected[key].keys()]);
});
