/**
 * A list that is one tab stop with roving focus (docs/spec-desktop.md, Keyboard): ↑/↓, Home,
 * End, Page Up and Page Down move the active row, as Core's `desktopKey` names them.
 */
import type { DesktopCommand } from "@wave/core";

/** The row [command] moves to from [active] in a list of [count] rows, [page] to a page. */
export const rovingTarget = (
  command: DesktopCommand | undefined,
  active: number,
  count: number,
  page: number,
): number | undefined => {
  if (count === 0) return undefined;
  const moves: Partial<Record<DesktopCommand, number>> = {
    rowDown: active + 1,
    rowUp: active - 1,
    firstRow: 0,
    lastRow: count - 1,
    pageDown: active + Math.max(1, page),
    pageUp: active - Math.max(1, page),
  };
  const to = command === undefined ? undefined : moves[command];
  return to === undefined ? undefined : Math.max(0, Math.min(count - 1, to));
};

/** Scrolls [list] so [row] shows, centred when [centre], else just inside its edges. */
export const scrollToRow = (
  list: HTMLElement,
  row: HTMLElement,
  centre: boolean,
  behavior: ScrollBehavior = "auto",
) => {
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  if (centre) {
    list.scrollTo({ top: top - (list.clientHeight - row.offsetHeight) / 2, behavior });
  } else if (top < list.scrollTop) list.scrollTo({ top, behavior });
  else if (bottom > list.scrollTop + list.clientHeight)
    list.scrollTo({ top: bottom - list.clientHeight, behavior });
};
