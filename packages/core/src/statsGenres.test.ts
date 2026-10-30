import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THEME } from "./theme.ts";
import { en } from "./catalogueEn.ts";
import { ptBR } from "./cataloguePtBr.ts";
import { statsGenrePodium, countedGenreSongIds, contrastRatio, type RecapGenre } from "./index.ts";

const family = (name: string, share: number): RecapGenre => ({
  family: { key: name.toLowerCase(), name },
  share,
});
const five = [
  family("Rock", 0.38),
  family("Pop", 0.24),
  family("Hip-Hop", 0.17),
  family("Electronic", 0.12),
  family("Jazz", 0.09),
];

test("the podium stands #1 in the middle, #2 left, #3 right, #4 and #5 at the edges, filling the width", () => {
  const bars = statsGenrePodium(five, 358, 44, DEFAULT_THEME.dark);
  assert.deepEqual(
    bars.map(({ rank, left, width }) => [rank, left, width]),
    [
      [4, 0, 76],
      [2, 58, 84],
      [1, 124, 110],
      [3, 216, 84],
      [5, 282, 76],
    ],
  );
});

test("fewer than five families keep their podium sizes and stand centred", () => {
  const place = (count: number) =>
    statsGenrePodium(five.slice(0, count), 358, 44, DEFAULT_THEME.dark).map(
      ({ rank, left, width }) => [rank, left, width],
    );
  assert.deepEqual(place(3), [
    [2, 58, 84],
    [1, 124, 110],
    [3, 216, 84],
  ]);
  assert.deepEqual(place(1), [[1, 124, 110]]);
  assert.deepEqual(statsGenrePodium([], 358, 44, DEFAULT_THEME.dark), []);
});

test("each bar tucks under its neighbour toward #1, and its rank and label use the part left showing", () => {
  const bars = statsGenrePodium(five, 358, 44, DEFAULT_THEME.dark);
  assert.deepEqual(
    bars.map(({ rank, visibleLeft, visibleWidth }) => [rank, visibleLeft, visibleWidth]),
    [
      [4, 0, 58],
      [2, 58, 66],
      [1, 124, 110],
      [3, 234, 66],
      [5, 300, 58],
    ],
  );
  const front = (rank: number) => bars.find((bar) => bar.rank === rank)!.layer;
  assert.ok(front(1) > front(2) && front(1) > front(3));
  assert.ok(front(2) > front(4) && front(3) > front(5));
});

test("bar heights follow the share relative to #1 above the floor", () => {
  const heights = (floor: number) =>
    statsGenrePodium(
      [family("Rock", 0.5), family("Pop", 0.25), family("Jazz", 0)],
      358,
      floor,
      DEFAULT_THEME.dark,
    ).map(({ rank, height }) => [rank, height]);
  assert.deepEqual(heights(44), [
    [2, 124],
    [1, 204],
    [3, 44],
  ]);
  assert.deepEqual(heights(72), [
    [2, 152],
    [1, 232],
    [3, 72],
  ]);
});

test("podium fills step from the accent at #1 to quieter shades, rank numbers at AA in both modes", () => {
  for (const theme of [
    DEFAULT_THEME.light,
    DEFAULT_THEME.dark,
    { accent: "#777777", background: "#eeeedd" },
  ]) {
    const bars = statsGenrePodium(five, 358, 44, theme);
    const byRank = [...bars].sort((a, b) => a.rank - b.rank);
    assert.equal(byRank[0]!.fill, theme.accent);
    assert.equal(new Set(bars.map((bar) => bar.fill)).size, 5);
    for (const bar of bars) assert.ok(contrastRatio(bar.ink, bar.fill) >= 4.5);
  }
});

test("Stats genre percentages are localised and a tiny positive share never reads as zero", () => {
  assert.equal(en.stats.genres, "Genres");
  assert.equal(ptBR.stats.genres, "Gêneros");
  assert.equal(en.stats.genrePercent(0.125), "12.5%");
  assert.equal(ptBR.stats.genrePercent(0.125), "12,5%");
  assert.equal(en.stats.genrePercent(0.001), "<1%");
});

test("genre reads omit skipped-only songs and retain counted Library and streamed ids", () => {
  assert.deepEqual(
    countedGenreSongIds([
      { id: 1, countedPlays: 0 },
      { id: 2, countedPlays: 3 },
      { id: "skip", countedPlays: 0 },
      { id: "stream", countedPlays: 1 },
    ]),
    [2, "stream"],
  );
});
