/**
 * One cell module for the whole catalog: margins, rows, tiles and the A–Z
 * spine are all whole multiples of it, so calm comes from alignment rather
 * than from emptiness.
 */
export const CELL = 8;

export const grid = {
  /** Screen side margin. */
  margin: CELL * 3,
  /** Gap between album tiles. */
  gutter: CELL * 2,
  /** Height of a track or entry row. */
  row: CELL * 7,
  /** Width of a row's fixed state cell (track number, playing, missing). */
  stateCell: CELL * 4,
  /** Width reserved on the right of a list for the A–Z spine. */
  spine: CELL * 3,
} as const;

/** Letter spacing for catalog lines (small tracked caps), in dp. */
export const CATALOG_TRACKING = 1.4;
