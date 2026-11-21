/** The fewest and the most song rows a full page of Now Playing's Related carousel holds. */
export const RELATED_PAGE_ROWS = { min: 4, max: 6 } as const;

/** How Related's songs are paged. */
export interface RelatedPages {
  /** Rows on every page; 0 with no songs. */
  readonly pageSize: number;
  /** How many songs show, from the first: the ones past it are left out. */
  readonly shown: number;
}

/** [fit] as a whole number of rows from 4 to 6. */
const rowsOf = (fit: number): number =>
  Number.isFinite(fit)
    ? Math.min(RELATED_PAGE_ROWS.max, Math.max(RELATED_PAGE_ROWS.min, Math.floor(fit)))
    : RELATED_PAGE_ROWS.min;

/**
 * The rows of one page of Related's carousel when [space] dp are free above
 * the similar artists and a row is [rowHeight] dp tall: as many whole rows as
 * fit, 6 at most, and 4 when fewer fit (the screen scrolls then) or either
 * isn't measured yet.
 */
export const relatedRowsThatFit = (space: number, rowHeight: number): number =>
  rowHeight > 0 ? rowsOf(space / rowHeight) : RELATED_PAGE_ROWS.min;

/**
 * Pages [count] related songs for a screen where [fit] rows fit (4 to 6; a
 * value outside reads as the nearest). With no more songs than fit, one page
 * shows them all. Otherwise every page is full: the size is the one from 4 to
 * [fit] that shows the most songs, the larger on a tie, and the songs past
 * the last full page are left out.
 */
export const relatedPages = (count: number, fit: number): RelatedPages => {
  const rows = rowsOf(fit);
  const songs = Math.max(0, Math.floor(count));
  if (songs <= rows) return { pageSize: songs, shown: songs };
  let best: RelatedPages = { pageSize: 0, shown: 0 };
  for (let pageSize = RELATED_PAGE_ROWS.min; pageSize <= rows; pageSize += 1) {
    const shown = Math.floor(songs / pageSize) * pageSize;
    if (shown >= best.shown) best = { pageSize, shown };
  }
  return best;
};
