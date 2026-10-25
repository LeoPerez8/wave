/** The part of Legend List's handle that places the Queue's scroll position. */
export type UpNextScroller = {
  getState(): { readonly scroll: number };
  scrollToOffset(params: { offset: number; animated?: boolean }): unknown;
};

/** How close to the start of Up Next the scroll counts as sitting there, in dp. */
const AT_START = 1;

/**
 * Places the Queue's list at the start of Up Next: the offset of its sticky
 * bar, with History above it out of sight. A list showing for the first time
 * lays itself out there (its initial offset). After that each showing, and a
 * new play while it shows, scroll there through the list, so the rows it
 * draws match the offset on screen, even when it sat out of sight while its
 * queue changed. While it shows, a list sitting at the start of Up Next
 * stays there as History grows or empties (the song changed); scrolled
 * anywhere else, the rows on screen hold still.
 *
 * `place` is the call to make on every showing and whenever the play context
 * or the start of Up Next changes while it shows; `hide`, when it goes out of
 * sight.
 */
export function upNextScroll<Context>() {
  let last: { list: UpNextScroller; context: Context; start: number } | undefined;
  let hidden = false;
  return {
    place(list: UpNextScroller | null, context: Context, start: number): void {
      if (list === null) return;
      const previous = last;
      const showing = hidden;
      hidden = false;
      last = { list, context, start };
      if (previous?.list !== list) return;
      const atStart = Math.abs(list.getState().scroll - previous.start) < AT_START;
      if (!showing && context === previous.context && !atStart) return;
      void list.scrollToOffset({ offset: start, animated: false });
    },
    hide(): void {
      hidden = true;
    },
  };
}
