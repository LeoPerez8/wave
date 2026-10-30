import { mix } from "./colour.ts";
import { contrastRatio } from "./palette.ts";
import type { RecapGenre } from "./recap.ts";
import { DEFAULT_THEME, RECAP_INK } from "./theme.ts";

/** Stats' read-only staircase: shares enlarge both dimensions above a readable label floor. */
export const statsGenreBlocks = (
  genres: readonly RecapGenre[],
  availableWidth: number,
  fontScale: number,
  labelHeight: number,
  mode: "light" | "dark",
) => {
  const largestWidth = Math.max(0, availableWidth - 32);
  const labelWidth = Math.min(largestWidth * 0.9, 192 * Math.max(1, fontScale));
  const theme = DEFAULT_THEME[mode];
  return genres.map((genre, index) => {
    const fill = mix(theme.accent, theme.background, index * 0.12);
    const ink =
      contrastRatio(RECAP_INK, fill) >= contrastRatio(DEFAULT_THEME.dark.background, fill)
        ? RECAP_INK
        : DEFAULT_THEME.dark.background;
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
