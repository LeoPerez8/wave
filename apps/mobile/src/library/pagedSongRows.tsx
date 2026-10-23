/** The rows Songs and a genre's songs share: read a page at a time, keyed by Track id. */
import type { OnViewableItemsChangedInfo } from "@legendapp/list/react-native";
import { PAGED_ROWS_LIMITS, showsExplicitBadge, type PagedRows } from "@wave/core";
import { useCallback, useRef, type ReactElement } from "react";
import { View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { songRowLine } from "@/catalog/cards/SongCard";
import { CELL, grid } from "@/catalog/grid";
import type { TrackSummary } from "@/catalog/TrackRow";
import { fileUri } from "@/lib/fileUri";
import { openTrackActionsById } from "@/playback/ActionsMenu";
import { selectableRow } from "@/selection/selectableRow";
import type { ListSelection } from "@/selection/useListSelection";

import type { SongSummary } from "./LibraryStore";
import { SwipeSummaryRow } from "./SwipeTrackRow";

/** A row as `TrackRow` draws it, as a song card: "Song · " before the artist. */
const songTrackSummary = (song: SongSummary): TrackSummary => ({
  id: String(song.id),
  title: song.title,
  artist: songRowLine(song.artist),
  durationMs: song.durationMs,
  artworkUri: fileUri(song.thumbPath),
  // A missing song: dimmed, as a YT Music song not downloaded is.
  missingTrackId: song.hasFile ? undefined : song.id,
  explicit: showsExplicitBadge(song.explicit),
});

/** A row whose page is still being read: its thumbnail's place, and nothing to press. */
function LoadingSongRow() {
  return (
    <View
      accessible
      accessibilityLabel="Loading song"
      className="flex-row items-center"
      style={{ height: grid.row }}
    >
      <Artwork uri={undefined} size={CELL * 5} radius={CELL / 2} />
    </View>
  );
}

export const songIdKey = (id: number): string => String(id);

/**
 * Song [id]'s row: [song] once its page is read, its place until then. A tap
 * runs [play], or toggles the row while [selection] is selecting.
 */
export const pagedSongRow = (
  id: number,
  song: SongSummary | undefined,
  {
    currentIds,
    favorites,
    selection,
    play,
  }: {
    readonly currentIds: ReadonlySet<string>;
    readonly favorites: ReadonlySet<number>;
    readonly selection: ListSelection<number>;
    readonly play: () => void;
  },
): ReactElement => {
  if (song === undefined) return <LoadingSongRow />;
  return (
    <SwipeSummaryRow
      summary={song}
      track={songTrackSummary(song)}
      state={currentIds.has(String(id)) ? "playing" : undefined}
      favorite={favorites.has(id)}
      leading="artwork"
      playDisc
      {...selectableRow(id, selection, play, (options) => openTrackActionsById(id, options))}
    />
  );
};

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
