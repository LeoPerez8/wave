import { mix } from "./colour.ts";
import { contrastRatio } from "./palette.ts";
import type { RecapGenre } from "./recap.ts";

/** Bar widths by rank, and how far each bar tucks under its neighbour, on a 358 dp podium. */
const PODIUM_WIDTHS = [110, 84, 84, 76, 76];
const PODIUM_OVERLAP = 18;
const PODIUM_SPAN = 358;
/** The rank number's line (title2) and the padding above and below it. */
const PODIUM_RANK_LINE = 28;
const PODIUM_RANK_PADDING = 16;
/** How much taller than the floor #1 stands. */
const PODIUM_RISE = 160;

/** Ranks from left to right: the even ones climb to #1 in the middle, the odd ones step down after it. */
const podiumOrder = (count: number): number[] => {
  const ranks = Array.from({ length: count }, (_, index) => index + 1);
  return [
    // oxlint-disable-next-line unicorn/no-array-reverse -- reverses a fresh array; Hermes lacks toReversed
    ...ranks.filter((rank) => rank % 2 === 0).reverse(),
    ...ranks.filter((rank) => rank % 2 === 1),
  ];
};

/**
 * Stats' read-only podium of genre bars, left to right. Five bars fill the width; fewer stand
 * centred at the same sizes.
 */
export const statsGenrePodium = (
  genres: readonly RecapGenre[],
  availableWidth: number,
  fontScale: number,
  theme: { accent: string; background: string },
) => {
  const scale = availableWidth / PODIUM_SPAN;
  const overlap = PODIUM_OVERLAP * scale;
  const order = podiumOrder(genres.length);
  const span = order.reduce(
    (sum, rank) => sum + PODIUM_WIDTHS[rank - 1]! * scale - overlap,
    overlap,
  );
  let left = (availableWidth - span) / 2;
  const floor = PODIUM_RANK_LINE * fontScale + PODIUM_RANK_PADDING;
  const top = Math.max(0, ...genres.map((genre) => genre.share));
  const middle = order.indexOf(1);
  return order.map((rank, index) => {
    const genre = genres[rank - 1]!;
    const width = PODIUM_WIDTHS[rank - 1]! * scale;
    const height = floor + (top > 0 ? PODIUM_RISE * (genre.share / top) : 0);
    const fill = mix(theme.accent, theme.background, (rank - 1) * 0.12);
    const ink =
      contrastRatio("#ffffff", fill) >= contrastRatio("#000000", fill) ? "#ffffff" : "#000000";
    // The neighbour toward #1 covers this bar's inner edge; the label takes the rest.
    const covered = index === middle ? 0 : overlap;
    const labelLeft = index > middle ? left + overlap : left;
    const bar = {
      ...genre,
      rank,
      left,
      width,
      height,
      fill,
      ink,
      labelLeft,
      labelWidth: width - covered,
      /** Higher draws in front: #1 over #2 and #3, they over #4 and #5. */
      layer: genres.length - rank,
    };
    left += width - overlap;
    return bar;
  });
};

/** Only counted songs need a genre read for Stats or Recap. */
export const countedGenreSongIds = <Song extends { id: number | string; countedPlays: number }>(
  songs: readonly Song[],
): Song["id"][] => songs.filter((song) => song.countedPlays > 0).map((song) => song.id);
