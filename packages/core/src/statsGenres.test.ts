import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THEME } from "./theme.ts";
import { en } from "./catalogueEn.ts";
import { ptBR } from "./cataloguePtBr.ts";
import { statsGenreBlocks, countedGenreSongIds, genrePlayShares, contrastRatio } from "./index.ts";

const genres = genrePlayShares(
  [
    { id: 1, countedPlays: 3, sortKey: "", listenedMs: 0, latestPlayAt: 0 },
    { id: 2, countedPlays: 1, sortKey: "", listenedMs: 0, latestPlayAt: 0 },
  ],
  [
    { id: 1, genre: "Rock" },
    { id: 2, genre: "Pop" },
  ],
);

test("Stats sizes both block dimensions by share above a common readable label floor", () => {
  const blocks = statsGenreBlocks(genres, 360, 1, 44, DEFAULT_THEME.light);
  assert.deepEqual(
    blocks.map(({ width, height, inset }) => [width, height, inset]),
    [
      [294, 148, 0],
      [226, 100, 8],
    ],
  );
  assert.deepEqual(statsGenreBlocks([], 360, 1, 44, DEFAULT_THEME.light), []);
});

for (const mode of ["light", "dark"] as const) {
  test(`${mode}: all five teal shades keep body labels at AA contrast with large text floors`, () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      ...genres[0]!,
      share: (5 - index) / 15,
    }));
    const blocks = statsGenreBlocks(five, 280, 2, 160, DEFAULT_THEME[mode]);
    for (const block of blocks) {
      assert.ok(contrastRatio(block.ink, block.fill) >= 4.5);
      assert.ok(block.width + block.inset <= 280);
      assert.ok(block.height >= 192);
    }
    assert.equal(new Set(blocks.map((block) => block.fill)).size, 5);
    assert.ok(blocks[0]!.height > blocks[4]!.height);
    assert.ok(blocks[0]!.width > blocks[4]!.width);
  });
}

test("Stats genre percentages are localised and a tiny positive share never reads as zero", () => {
  assert.equal(en.stats.genres, "Genres");
  assert.equal(ptBR.stats.genres, "Gêneros");
  assert.equal(en.stats.genrePercent(0.125), "12.5%");
  assert.equal(ptBR.stats.genrePercent(0.125), "12,5%");
  assert.equal(en.stats.genrePercent(0.001), "<1%");
});

test("chosen accent and background determine the shades, with AA ink even for middle grey", () => {
  for (const accent of ["#777777", "#ffcc00", "#400080"]) {
    const blocks = statsGenreBlocks(genres, 360, 1, 44, { accent, background: "#eeeedd" });
    assert.equal(blocks[0]!.fill, accent);
    assert.notEqual(blocks[1]!.fill, accent);
    for (const block of blocks) assert.ok(contrastRatio(block.ink, block.fill) >= 4.5);
  }
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
