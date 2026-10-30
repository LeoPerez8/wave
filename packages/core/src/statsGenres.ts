import { mix } from "./colour.ts";
import { contrastRatio } from "./palette.ts";
import type { RecapGenre } from "./recap.ts";

/** Stats' read-only staircase: shares enlarge both dimensions above a readable label floor. */
export const statsGenreBlocks = (
  genres: readonly RecapGenre[],
  availableWidth: number,
  fontScale: number,
  labelHeight: number,
  theme: { accent: string; background: string },
) => {
  const largestWidth = Math.max(0, availableWidth - 32);
  const labelWidth = Math.min(largestWidth * 0.9, 192 * Math.max(1, fontScale));
  return genres.map((genre, index) => {
    const fill = mix(theme.accent, theme.background, index * 0.12);
    const ink =
      contrastRatio("#ffffff", fill) >= contrastRatio("#000000", fill) ? "#ffffff" : "#000000";
    return {
      ...genre,
      width: labelWidth + (largestWidth - labelWidth) * genre.share,
      height: labelHeight + 32 + 96 * genre.share,
      inset: index * 8,
      fill,
      ink,
    };
  });
};

/** Only counted songs need a genre read for Stats or Recap. */
export const countedGenreSongIds = <Song extends { id: number | string; countedPlays: number }>(
  songs: readonly Song[],
): Song["id"][] => songs.filter((song) => song.countedPlays > 0).map((song) => song.id);
