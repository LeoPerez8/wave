/** Page visibility and selection prefetch for the shared song list. */
import type { OnViewableItemsChangedInfo } from "@legendapp/list/react-native";
import { PAGED_ROWS_LIMITS, type PagedRows } from "@wave/core";
import { useCallback, useRef } from "react";
import type { ListSelection } from "@/selection/useListSelection";
import type { SongSummary } from "./LibraryStore";

export const songIdKey = (id: number): string => String(id);

/** Rows read past the screen each way while selecting, so checking one acts at once. */
const SELECTING_AHEAD = PAGED_ROWS_LIMITS.pageSize;

/**
 * The rows on screen of a list of [ids] read through [pages]: `onViewableItemsChanged`
 * tells the pages what's on screen and, while [selection] is on, [want]s the rows near it;
 * `nearScreen` is those ids, SELECTING_AHEAD past the screen each way.
 */
export const useRowsNearScreen = (
  ids: readonly number[],
  pages: PagedRows<number, SongSummary>,
  selection: ListSelection<number>["selection"],
  want: (ids: readonly number[]) => void,
) => {
  const shown = useRef({ start: 0, end: PAGED_ROWS_LIMITS.pageSize });
  const nearScreen = useCallback(
    () =>
      ids.slice(
        Math.max(0, shown.current.start - SELECTING_AHEAD),
        shown.current.end + SELECTING_AHEAD,
      ),
    [ids],
  );
  const onViewableItemsChanged = useCallback(
    ({ startBuffered, endBuffered }: OnViewableItemsChangedInfo<number>) => {
      const start = Math.max(0, startBuffered);
      const end = Math.max(start, endBuffered + 1);
      shown.current = { start, end };
      pages.view(start, end);
      if (selection !== null) want(nearScreen());
    },
    [pages, selection, want, nearScreen],
  );
  return { nearScreen, onViewableItemsChanged };
};
