import assert from "node:assert/strict";
import test from "node:test";
import {
  magicArtistKey,
  magicQueuePicks,
  refreshedMagicQueuePicks,
  magicQueuePicksSteps,
  seededRandom,
  type MagicSong,
  type MagicQueuePicks,
} from "./index.ts";

test("stepped Home picks preserve ti's complete ordered picks for new days, removed songs, fills and pulls", () => {
  const songs: MagicSong[] = Array.from({ length: 47 }, (_, i) => ({
    trackId: String(i),
    artists: [magicArtistKey("a" + (i % 3))],
    genre: "rock",
    style: null,
  }));
  const now = 1700000000000;
  const initial = magicQueuePicks(null, songs, {
    now,
    taste: null,
    random: seededRandom("initial"),
  });
  const cases: (MagicQueuePicks | null)[] = [
    null,
    initial,
    { ...initial, day: "yesterday" },
    { ...initial, trackIds: ["gone", ...initial.trackIds.slice(1)] },
    { ...initial, trackIds: initial.trackIds.slice(0, 2) },
    // A stored list read back with a song twice: ti counts both places as kept.
    { ...initial, trackIds: [initial.trackIds[0]!, ...initial.trackIds.slice(0, 7), "gone"] },
  ];
  for (const previous of cases)
    for (const refresh of [false, true]) {
      const options = () => ({
        now,
        taste: {
          at: now,
          songs: new Map([["1", 3]]),
          artists: new Map([["a0", -7]]),
          genres: new Map([["rock", 13]]),
        },
        random: seededRandom("picks"),
      });
      const expected =
        refresh && previous
          ? refreshedMagicQueuePicks(previous, songs, options())
          : magicQueuePicks(previous, songs, options());
      const steps = magicQueuePicksSteps(previous, songs, options(), refresh);
      let result = steps.next();
      let count = 0;
      while (!result.done) {
        count++;
        result = steps.next();
      }
      assert.deepEqual(result.value, expected);
      if (previous !== initial || refresh) assert.ok(count > songs.length);
    }
});

const song = (id: string): MagicSong => ({
  trackId: id,
  artists: [magicArtistKey("a" + id)],
  genre: null,
  style: null,
});

test("stepped Home picks match ti when the Library holds a song twice or fewer than nine", () => {
  const now = 1700000000000;
  const libraries = [
    ["1", "2", "2", "3"].map(song),
    Array.from({ length: 12 }, (_, i) => song(String(i % 8))),
  ];
  for (const songs of libraries) {
    const today = magicQueuePicks(null, songs, { now, taste: null, random: seededRandom("t") });
    for (const previous of [today, { ...today, trackIds: [...today.trackIds, "gone"] }])
      for (const refresh of [false, true]) {
        const options = () => ({ now, taste: null, random: seededRandom("again") });
        const expected = refresh
          ? refreshedMagicQueuePicks(previous, songs, options())
          : magicQueuePicks(previous, songs, options());
        const steps = magicQueuePicksSteps(previous, songs, options(), refresh);
        let result = steps.next();
        while (!result.done) result = steps.next();
        assert.deepEqual(result.value, expected);
      }
  }
});
