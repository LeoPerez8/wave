/** The part of Legend List's handle that places Up Next's scroll position. */
export type UpNextScroller = {
  getState(): { readonly scroll: number };
  scrollToOffset(params: { offset: number; animated?: boolean }): unknown;
};

/**
 * Places Up Next each time it shows. A list showing for the first time lays
 * itself out. After that a new play's Up Next starts from the top, and the
 * same play's keeps its place. Either way the scroll goes through the list,
 * so the rows it draws match the offset on screen, even when it sat out of
 * sight while its queue changed.
 *
 * Returns the call to make on every showing, and whenever the play context
 * changes while it shows.
 */
export function upNextScroll<Context>() {
  let last: { list: UpNextScroller; context: Context } | undefined;
  return (list: UpNextScroller | null, context: Context): void => {
    if (list === null) return;
    const previous = last;
    last = { list, context };
    if (previous?.list !== list) return;
    const offset = context === previous.context ? list.getState().scroll : 0;
    void list.scrollToOffset({ offset, animated: false });
  };
}
