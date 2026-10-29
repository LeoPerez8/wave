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
 * new play or a shuffle toggle while it shows (a new [shuffle], which
 * reorders Up Next and leaves History as it is), scroll there through the
 * list, so the rows it draws match the offset on screen, even when it sat out
 * of sight while its queue changed. While it shows, a list sitting at the
 * start of Up Next stays there as History grows or empties (the song
 * changed); scrolled anywhere else, the rows on screen hold still.
 *
 * `place` is the call to make on every showing and whenever the play context,
 * the shuffle or the start of Up Next changes while it shows; `hide`, when it
 * goes out of sight.
 */
export function upNextScroll<Context>() {
  let last: { list: UpNextScroller; context: Context; start: number; shuffle: unknown } | undefined;
  let hidden = false;
  return {
    place(list: UpNextScroller | null, context: Context, start: number, shuffle?: unknown): void {
      if (list === null) return;
      const previous = last;
      const showing = hidden;
      hidden = false;
      last = { list, context, start, shuffle };
      if (previous?.list !== list) return;
      const atStart = Math.abs(list.getState().scroll - previous.start) < AT_START;
      const reordered = context !== previous.context || shuffle !== previous.shuffle;
      if (!showing && !reordered && !atStart) return;
      void list.scrollToOffset({ offset: start, animated: false });
    },
    hide(): void {
      hidden = true;
    },
  };
}

/**
 * The room under Up Next that lets its start (the sticky bar) scroll to the
 * top of a [listHeight] list however short Up Next is, History out of sight
 * above it: what the list lacks below the bar, its [count] rows of [row] and
 * the [bottomInset] included. The footer stands at least this tall, so its
 * own content counts toward it.
 *
 * Legend List's `anchoredEndSpace` would work this out too, but it renders
 * every row from the anchor on to measure them, all of a long Up Next (#709).
 */
export const upNextEndSpace = (
  listHeight: number,
  layout: { bar: number; row: number; count: number; bottomInset: number },
): number => Math.max(0, listHeight - layout.bar - layout.count * layout.row - layout.bottomInset);

/**
 * Where the Queue's Back to Current Song pill points to bring back the start
 * of Up Next (its sticky bar, at [start] in the list), or null while it's in
 * sight: down when the list is scrolled up into History, up when it's more
 * than one screen (the [listHeight] list's height) down Up Next. A little way
 * down Up Next shows no pill, nor does a list not laid out yet.
 */
export const backToCurrentSong = (
  scroll: number,
  start: number,
  listHeight: number,
): "up" | "down" | null => {
  "worklet";
  if (listHeight <= 0) return null;
  if (scroll < start - AT_START) return "down";
  return scroll > start + listHeight ? "up" : null;
};
