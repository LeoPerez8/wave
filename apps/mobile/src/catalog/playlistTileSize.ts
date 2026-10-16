import { CELL } from "./grid";

/** A `PlaylistTile`'s caption: the space above it, and each line's place (name, count). */
export const PLAYLIST_CAPTION = { top: CELL * 1.5, line: CELL * 3 } as const;

/** Space between rows of tiles. */
const ROW_GAP = CELL * 3;

/**
 * Height of a row of [size] tiles, gap included, so the list lays out by
 * index: the cover, then the name, and the count when [withDetail].
 */
export const playlistTileRowHeight = (size: number, withDetail: boolean): number =>
  size + PLAYLIST_CAPTION.top + PLAYLIST_CAPTION.line * (withDetail ? 2 : 1) + ROW_GAP;
