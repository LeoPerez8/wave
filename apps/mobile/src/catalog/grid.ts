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
  /** Width of a numbered row's leading cell (track number, missing). */
  stateCell: CELL * 4,
  /** Width of the drawn A–Z spine. */
  spine: CELL * 3,
  /**
   * Gap between the spine and the screen edge, keeping it clear of the system
   * Back gesture zone (Android only lets an app exclude 200dp per edge).
   */
  spineInset: CELL * 3,
} as const;

/** Letter spacing for catalog lines (small tracked caps), in dp. */
export const CATALOG_TRACKING = 1.4;
