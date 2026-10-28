import { IconGripVertical } from "@tabler/icons-react-native";
import { playlistFindText, type PlaylistFindText, type PlaylistLayout } from "@wave/core";
import { useScrollToTop } from "expo-router";
import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react";
import { useWindowDimensions, View, type ScrollViewInstance } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { CAPTION_TOP, titleLineHeight } from "@/catalog/cards/CardParts";
import { SLEEVE_ROOM } from "@/catalog/cards/PlaylistCard";
import { CELL, grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { useListScrollable } from "@/motion/heldTouch";
import { useThemeColor } from "@/theme/useThemeColor";

import { FindFrame, FindHead, useFindInList } from "./FindInPlaylist";
import {
  useDragCell,
  useListDrag,
  type DragCells,
  type DragHandlers,
  type DragState,
  type ListDrag,
} from "./listDrag";
import type { PlaylistRow } from "./LibraryStore";
import { moveShownPlaylist } from "./playlistOrder";

/** The handle's touch target across: 48 dp, the handle drawn at its end. */
const GRIP_TARGET = grid.stateCell + CELL * 2;
/** Room a tile's name leaves at its end for the handle drawn over it. */
export const TILE_GRIP_INSET = CELL * 4;

/** Where the playlists sit: a cell per playlist, [columns] to a row. */
interface Cells extends DragCells {
  /** A cell's own width, or undefined for the full width (one column). */
  readonly tile: number | undefined;
}

type CellProps = {
  index: number;
  cells: Cells;
  layout: PlaylistLayout;
  drag: DragState;
  /** Whether the playlist can be dragged: not while selecting, nor while Find narrows the list. */
  arrangeable: boolean;
  children: ReactNode;
  handlers: DragHandlers;
};

/**
 * A playlist in its cell, with a handle to drag it elsewhere: at the row's
 * end in the list, over the end of the name's line on a tile. Other
 * playlists step aside, back or on one place, as it passes them.
 */
function ArrangeableCell({
  index,
  cells,
  layout,
  drag,
  arrangeable,
  children,
  handlers,
}: CellProps) {
  const fill = useThemeColor("fill");
  const secondary = useThemeColor("secondary");
  const { fontScale } = useWindowDimensions();
  const { columns, width, height } = cells;
  const list = layout === "list";
  const titleHeight = titleLineHeight(fontScale);
  const gripHeight = Math.max(GRIP_TARGET, titleHeight + CELL * 2);
  const { style: cellStyle, grip } = useDragCell({
    drag,
    index,
    cells,
    enabled: arrangeable,
    liftedColor: list ? fill : undefined,
    handlers,
  });

  const handle = (
    <GestureDetector gesture={grip}>
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        className="items-end justify-center"
        style={
          list
            ? { width: GRIP_TARGET, height: grid.row, marginLeft: -CELL * 2 }
            : {
                position: "absolute",
                right: 0,
                // Centred on the name's line, which sits under the sleeves and the cover.
                top: (cells.tile ?? 0) + SLEEVE_ROOM + CAPTION_TOP + (titleHeight - gripHeight) / 2,
                width: GRIP_TARGET,
                height: gripHeight,
              }
        }
      >
        {/* Hidden, not removed, while selecting or finding: the cells keep their size. */}
        {arrangeable && <IconGripVertical size={20} color={secondary} strokeWidth={1.5} />}
      </View>
    </GestureDetector>
  );

  const column = index % columns;
  return (
    <Animated.View
      // Placed by index: only a window of rows is mounted (see `rowWindow`).
      style={[
        {
          position: "absolute",
          top: Math.floor(index / columns) * height,
          left: column * width,
          ...(cells.tile === undefined ? { right: 0 } : { width: cells.tile }),
        },
        cellStyle,
      ]}
    >
      {list ? (
        <View className="flex-row items-center">
          <View className="flex-1">{children}</View>
          {handle}
        </View>
      ) : (
        <View>
          {children}
          {handle}
        </View>
      )}
    </Animated.View>
  );
}

type Props = {
  /** In the order the list shows them. */
  playlists: readonly PlaylistRow[];
  layout: PlaylistLayout;
  /** The cover's side in this layout's tiles. */
  tile: number;
  /** A row's height in this layout, gap included. */
  rowHeight: number;
  /** Whether the list is in selection mode: handles hide, nothing drags. */
  selecting: boolean;
  /**
   * The list's head (the count, Import Playlists and New Playlist), under the
   * Find field, stepping aside while a query narrows the list.
   */
  header: ReactElement;
  /**
   * Under the Find field, above the head, staying while a query narrows the
   * list (the batch's "Importing playlists · 12 of 80").
   */
  lead?: ReactNode;
  /**
   * Draws the playlist at [index] of the playlists shown as the layout shows
   * it; [arrangeable] says whether it can be moved (not while selecting or
   * while Find narrows the list).
   */
  renderPlaylist: (playlist: PlaylistRow, index: number, arrangeable: boolean) => ReactNode;
};

/** What finds a playlist in Find in Playlists: its name alone. */
const playlistFind = (playlist: PlaylistRow): PlaylistFindText => playlistFindText(playlist.name);

/**
 * The Playlists list in any layout and any sort: each playlist has a handle
 * that drags it to a new place (scrolling the list near its edges), across a
 * grid's columns as well as down. A drop keeps the new order at once,
 * everywhere, switching to Custom from the order on screen under another sort.
 * Find in Playlists waits above the head until the list is pulled down; a
 * query narrows the list to the playlists found, in the list's order, and
 * nothing drags until it's cleared.
 */
export function ArrangeablePlaylists({
  playlists,
  layout,
  tile,
  rowHeight,
  selecting,
  header,
  lead,
  renderPlaylist,
}: Props) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const columns = layout === "grid" ? 2 : 1;
  const cells: Cells = {
    columns,
    width: tile + grid.gutter,
    height: rowHeight,
    tile: layout === "list" ? undefined : tile,
  };
  // The scroll handles Find keeps the list's place with, once the drag machinery has them.
  const scrolling = useRef<ListDrag | null>(null);
  const find = useFindInList(
    playlists,
    playlistFind,
    () => scrolling.current?.drag.scroll.get() ?? 0,
    (y) => scrolling.current?.scrollRef.current?.scrollTo({ y, animated: false }),
  );
  // One object for the list's life: a new one on a re-render (Keep Find Field Visible
  // toggled) would snap the list back to where it opened.
  const [contentOffset] = useState(() => ({ x: 0, y: find.initialOffset }));
  const shown = find.shown;
  const arrangeable = !selecting && find.found === null;
  const idsRef = useRef<readonly number[]>([]);
  useLayoutEffect(() => {
    idsRef.current = shown.map((playlist) => playlist.id);
  });
  const listDrag = useListDrag({
    count: shown.length,
    cells,
    bottomInset,
    move: (from, to) => moveShownPlaylist(idsRef.current, from, to),
  });
  useLayoutEffect(() => {
    scrolling.current = listDrag;
  });
  const { scrollRef } = listDrag;
  // The tab bar's second tap scrolls it to the top, as the other lists.
  useScrollToTop(scrollRef as unknown as RefObject<ScrollViewInstance>);

  const renderCell = (index: number) => {
    const playlist = shown[index];
    if (playlist === undefined) return null;
    return (
      <ArrangeableCell
        key={playlist.id}
        index={index}
        cells={cells}
        layout={layout}
        drag={listDrag.drag}
        arrangeable={arrangeable}
        handlers={listDrag}
      >
        {renderPlaylist(playlist, index, arrangeable)}
      </ArrangeableCell>
    );
  };

  return (
    <FindFrame find={find} of="playlists">
      <Animated.ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEnabled={scrollable}
        ref={scrollRef}
        className="flex-1"
        onLayout={listDrag.onLayout}
        onContentSizeChange={listDrag.onContentSizeChange}
        // Find in Playlists waits above the head until the list is pulled down (unless it's pinned).
        contentOffset={contentOffset}
        contentContainerStyle={{
          paddingHorizontal: grid.margin,
          paddingBottom: bottomInset,
          minHeight: find.minHeight,
        }}
      >
        <View onLayout={listDrag.onHeaderLayout}>
          <FindHead find={find} header={header} lead={lead} of="playlists" />
        </View>
        <View style={{ height: Math.ceil(shown.length / columns) * rowHeight }}>
          {listDrag.indices.map(renderCell)}
        </View>
      </Animated.ScrollView>
    </FindFrame>
  );
}
