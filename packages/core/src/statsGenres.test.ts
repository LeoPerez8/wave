import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./catalogueEn.ts";
import { ptBR } from "./cataloguePtBr.ts";
import { statsGenreBlocks, genrePlayShares, contrastRatio } from "./index.ts";

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
  const blocks = statsGenreBlocks(genres, 360, 1, 44, "light");
  assert.deepEqual(
    blocks.map(({ width, height, inset }) => [width, height, inset]),
    [
      [294, 148, 0],
      [226, 100, 8],
    ],
  );
  assert.deepEqual(statsGenreBlocks([], 360, 1, 44, "light"), []);
});

for (const mode of ["light", "dark"] as const) {
  test(`${mode}: all five teal shades keep body labels at AA contrast with large text floors`, () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      ...genres[0]!,
      share: (5 - index) / 15,
    }));
    const blocks = statsGenreBlocks(five, 280, 2, 160, mode);
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
