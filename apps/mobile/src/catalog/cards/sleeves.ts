/** A sleeve is a bar of this height and the gap after it: a tile's, then a row's (smaller). */
export const TILE_SLEEVES = { edge: 3, gap: 2 } as const;
export const ROW_SLEEVES = { edge: 2, gap: 1 } as const;

/**
 * Where a playlist's cover starts under the top of its card: below its two
 * sleeves, each a bar and its gap ([small] for a row's), or at the top for a
 * plain cover (the Playlists page draws no sleeves).
 */
export const coverTop = ({ sleeves, small = false }: { sleeves: boolean; small?: boolean }): number => {
  if (!sleeves) return 0;
  const { edge, gap } = small ? ROW_SLEEVES : TILE_SLEEVES;
  return (edge + gap) * 2;
};
