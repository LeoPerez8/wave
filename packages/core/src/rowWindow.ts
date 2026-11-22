/**
 * Windowed rendering of a long list of fixed-height rows (a playlist's songs):
 * which rows to mount so the screen is covered, with room to scroll either
 * way before the window has to move.
 */

export interface RowView {
  /** How far the list is scrolled, in dp. */
  readonly scroll: number;
  /** Height of the visible part of the list, in dp. */
  readonly viewport: number;
  /** Where the first row starts in the scrolled content (the header's height), in dp. */
  readonly top: number;
  readonly rowHeight: number;
  /** Rows in the list. */
  readonly count: number;
}

/** Rows [start, end) are mounted. */
export interface RowWindow {
  readonly start: number;
  readonly end: number;
}

const clamp = (value: number, count: number): number => Math.max(0, Math.min(count, value));

/**
 * The rows to mount: those on screen plus a screenful above and below, so a
 * fling has rows waiting before the next window renders. While the screen
 * still has half a screenful of mounted rows to spare on both sides, the
 * [current] window is returned as is, so scrolling re-renders only now and then.
 */
export const rowWindow = (
  { scroll, viewport, top, rowHeight, count }: RowView,
  current?: RowWindow,
): RowWindow => {
  const fresh = {
    start: clamp(Math.floor((scroll - viewport - top) / rowHeight), count),
    end: clamp(Math.ceil((scroll + viewport * 2 - top) / rowHeight), count),
  };
  if (current === undefined || current.end > count) return fresh;
  const spare = viewport / 2;
  const coversAbove =
    current.start <= fresh.start || current.start * rowHeight + top <= scroll - spare;
  const coversBelow =
    current.end >= fresh.end || current.end * rowHeight + top >= scroll + viewport + spare;
  return coversAbove && coversBelow ? current : fresh;
};

/**
 * The indices to mount for [window], in order, plus [keep] (the row being
 * dragged, or -1) when it has scrolled out of it: unmounting it would end the drag.
 * [limit] caps how many of the window's rows mount, from its start, while a
 * first mount is spread over frames (#1440); a dragged row stays mounted past it.
 */
export const windowRows = (
  window: RowWindow,
  keep: number,
  limit: number = Number.POSITIVE_INFINITY,
): number[] => {
  const { start } = window;
  const end = Math.min(window.end, start + Math.max(0, limit));
  const rows: number[] = [];
  if (keep >= 0 && keep < start) rows.push(keep);
  for (let index = start; index < end; index++) rows.push(index);
  if (keep >= end) rows.push(keep);
  return rows;
};
