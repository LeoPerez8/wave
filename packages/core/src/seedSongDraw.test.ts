import assert from "node:assert/strict";
import { test } from "node:test";
import { drawSeedSongs, seededRandom, type SeedSong } from "./index.ts";

const song = (id: string, artist: string, extra: Partial<SeedSong> = {}): SeedSong => ({
  id,
  artist,
  ...extra,
});

test("a draw gives at most 3 songs, each by a different artist", () => {
  const songs = [
    song("a1", "Alpha"),
    song("a2", "alpha"),
    song("b1", "Beta"),
    song("b2", "Beta"),
    song("c1", "Gamma"),
    song("d1", "Delta"),
  ];
  for (let run = 0; run < 50; run++) {
    const drawn = drawSeedSongs(songs, { weight: "plays", random: seededRandom(`run ${run}`) });
    assert.equal(drawn.length, 3);
    const artists = drawn.map((picked) => picked.artist.toLowerCase());
    assert.equal(new Set(artists).size, 3);
  }
});

/** How many of [runs] single-song draws from [songs] picked each id. */
const tally = (songs: readonly SeedSong[], weight: "plays" | "added", runs = 1000) => {
  const counts = new Map<string, number>();
  for (let run = 0; run < runs; run++) {
    const [picked] = drawSeedSongs(songs, { count: 1, weight, random: seededRandom(`t${run}`) });
    if (picked !== undefined) counts.set(picked.id, (counts.get(picked.id) ?? 0) + 1);
  }
  return counts;
};

test("the most played songs are drawn most often, the unplayed still sometimes", () => {
  const counts = tally(
    [song("hit", "A", { plays: 99 }), song("rare", "B", { plays: 0 }), song("none", "C")],
    "plays",
  );
  assert.ok((counts.get("hit") ?? 0) > 700, `hit drawn ${counts.get("hit")} times`);
  assert.ok((counts.get("rare") ?? 0) > 20);
  assert.ok((counts.get("none") ?? 0) > 20);
});

test("asked for the most recently added, the newest songs are drawn most often", () => {
  const counts = tally(
    [
      song("old", "A", { addedAt: 1_000, plays: 500 }),
      song("older", "B", { addedAt: 500 }),
      song("undated", "C"),
      song("new", "D", { addedAt: 9_000 }),
    ],
    "added",
  );
  const newest = counts.get("new") ?? 0;
  for (const id of ["old", "older", "undated"])
    assert.ok(newest > 1.5 * (counts.get(id) ?? 0), `new ${newest} vs ${id} ${counts.get(id)}`);
  assert.ok((counts.get("old") ?? 0) > (counts.get("undated") ?? 0));
});

test("songs added together weigh alike", () => {
  const counts = tally([song("x", "A", { addedAt: 5 }), song("y", "B", { addedAt: 5 })], "added");
  assert.ok(Math.abs((counts.get("x") ?? 0) - (counts.get("y") ?? 0)) < 150);
});

test("songs drawn recently are left out while others remain", () => {
  const songs = [
    song("a1", "A", { plays: 1000 }),
    song("a2", "A"),
    song("b1", "B", { plays: 1000 }),
    song("b2", "B"),
    song("c1", "C", { plays: 1000 }),
  ];
  for (let run = 0; run < 30; run++) {
    const drawn = drawSeedSongs(songs, {
      weight: "plays",
      recent: ["a1", "b1"],
      random: seededRandom(`r${run}`),
    }).map((picked) => picked.id);
    assert.deepEqual(drawn.toSorted(), ["a2", "b2", "c1"]);
  }
});

test("an artist with only recent songs gets its least recently drawn one", () => {
  const songs = [song("a1", "A"), song("a2", "A"), song("b1", "B"), song("c1", "C")];
  const drawn = drawSeedSongs(songs, {
    weight: "plays",
    recent: ["b1", "a1", "c1", "a2"],
    random: seededRandom("lru"),
  }).map((picked) => picked.id);
  assert.deepEqual(drawn, ["b1", "a1", "c1"]);
});

test("a list of one artist draws a different song each time until it runs out", () => {
  const songs = ["s1", "s2", "s3", "s4"].map((id) => song(id, "Solo", { plays: 3 }));
  const recent: string[] = [];
  for (let draw = 0; draw < 4; draw++) {
    const drawn = drawSeedSongs(songs, {
      weight: "plays",
      recent,
      random: seededRandom(`${draw}`),
    });
    assert.equal(drawn.length, 1);
    assert.ok(!recent.includes(drawn[0]!.id), `draw ${draw} repeated ${drawn[0]!.id}`);
    recent.push(drawn[0]!.id);
  }
  const [again] = drawSeedSongs(songs, { weight: "plays", recent, random: seededRandom("x") });
  assert.equal(again?.id, recent[0]);
});
