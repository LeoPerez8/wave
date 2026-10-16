import { IconGripVertical } from "@tabler/icons-react-native";
import {
  reorderGridShift,
  reorderGridTarget,
  rowWindow,
  windowRows,
  type PlaylistLayout,
  type RowView,
  type RowWindow,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { useScrollToTop } from "expo-router";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useWindowDimensions, View, type ScrollViewInstance } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  measure,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useScrollOffset,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { PLAYLIST_CAPTION } from "@/catalog/playlistTileSize";
import { useChromeInset } from "@/chrome/chrome";
import { useListScrollable } from "@/motion/heldTouch";
import { useThemeColor } from "@/theme/useThemeColor";

import type { PlaylistRow } from "./LibraryStore";
import { moveShownPlaylist } from "./playlistOrder";

/** How close to the top or bottom of the list a dragged playlist starts scrolling it. */
const SCROLL_ZONE = grid.row;
/** Fastest auto-scroll, in dp per frame, with the finger at the very edge. */
const SCROLL_STEP = CELL;
const SHIFT_MS = 120;
/** The handle's touch target across: 48 dp, the handle drawn at its end. */
const GRIP_TARGET = grid.stateCell + CELL * 2;
/** Room a tile's name leaves at its end for the handle drawn over it. */
export const TILE_GRIP_INSET = CELL * 4;

/** What every playlist shares while one of them is dragged. */
interface DragState {
  /** The dragged playlist's index, or -1. */
  readonly active: SharedValue<number>;
  /** Where it would land if dropped now. */
  readonly hover: SharedValue<number>;
  /** How far it has moved across and down, scrolling included. */
  readonly dragX: SharedValue<number>;
  readonly dragY: SharedValue<number>;
  /** The finger's travel down since the drag began, scrolling not included. */
  readonly translation: SharedValue<number>;
  readonly fingerY: SharedValue<number>;
  readonly startScroll: SharedValue<number>;
  readonly scroll: SharedValue<number>;
}

/** Where the playlists sit: a cell per playlist, [columns] to a row. */
interface Cells {
  readonly columns: number;
  /** From one cell's left edge to the next one's, gutter included (grid). */
  readonly width: number;
  /** From one row's top to the next one's. */
  readonly height: number;
  /** A cell's own width, or undefined for the full width (one column). */
  readonly tile: number | undefined;
}

type CellProps = {
  index: number;
  cells: Cells;
  layout: PlaylistLayout;
  drag: DragState;
  /** Whether the list is in selection mode: no dragging then. */
  selecting: boolean;
  children: ReactNode;
  onDragBegin: (index: number) => void;
  onDragMove: (dx: number, dy: number) => void;
  onDrop: (canceled: boolean) => void;
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
  selecting,
  children,
  onDragBegin,
  onDragMove,
  onDrop,
}: CellProps) {
  const fill = useThemeColor("fill");
  const secondary = useThemeColor("secondary");
  const reduceMotion = useReducedMotion();
  const { active, hover, dragX, dragY, translation, fingerY, startScroll, scroll } = drag;
  const { columns, width, height } = cells;

  // Other playlists make way for the dragged one.
  const shiftX = useSharedValue(0);
  const shiftY = useSharedValue(0);
  useAnimatedReaction(
    () => {
      const from = active.get();
      if (from === -1) return { x: 0, y: 0 };
      return reorderGridShift({ index, from, to: hover.get(), columns });
    },
    (next, previous) => {
      if (previous !== null && next.x === previous.x && next.y === previous.y) return;
      const x = next.x * width;
      const y = next.y * height;
      // A drop lands at once: the list re-renders in the new order underneath.
      const now = active.get() === -1 || reduceMotion;
      shiftX.set(now ? x : withTiming(x, { duration: SHIFT_MS }));
      shiftY.set(now ? y : withTiming(y, { duration: SHIFT_MS }));
    },
    [index, columns, width, height, reduceMotion],
  );

  const list = layout === "list";
  const cellStyle = useAnimatedStyle(() => {
    const dragged = active.get() === index;
    return {
      zIndex: dragged ? 1 : 0,
      backgroundColor: dragged && list ? fill : "transparent",
      transform: [
        { translateX: dragged ? dragX.get() : shiftX.get() },
        { translateY: dragged ? dragY.get() : shiftY.get() },
      ],
    };
  });

  const grip = usePanGesture({
    enabled: !selecting,
    minDistance: 0,
    onActivate: (event) => {
      "worklet";
      startScroll.set(scroll.get());
      translation.set(0);
      dragX.set(0);
      dragY.set(0);
      fingerY.set(event.absoluteY);
      hover.set(index);
      active.set(index);
      scheduleOnRN(onDragBegin, index);
    },
    onUpdate: (event) => {
      "worklet";
      translation.set(event.translationY);
      fingerY.set(event.absoluteY);
      dragX.set(columns > 1 ? event.translationX : 0);
      dragY.set(event.translationY + scroll.get() - startScroll.get());
      scheduleOnRN(onDragMove, dragX.get(), dragY.get());
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(onDrop, event.canceled);
    },
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
                top: (cells.tile ?? 0) + PLAYLIST_CAPTION.top - CELL,
                width: GRIP_TARGET,
                height: PLAYLIST_CAPTION.line + CELL * 2,
              }
        }
      >
        {/* Hidden, not removed, while selecting: the cells keep their size. */}
        {!selecting && <IconGripVertical size={20} color={secondary} strokeWidth={1.5} />}
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
  /** In the order the owner arranged them. */
  playlists: readonly PlaylistRow[];
  layout: PlaylistLayout;
  /** The cover's side in this layout's tiles. */
  tile: number;
  /** A row's height in this layout, gap included. */
  rowHeight: number;
  /** Whether the list is in selection mode: handles hide, nothing drags. */
  selecting: boolean;
  /** Import Playlists and New Playlist, over the playlists. */
  header: ReactElement;
  /** Draws the playlist at [index] as the layout shows it. */
  renderPlaylist: (playlist: PlaylistRow, index: number) => ReactNode;
};

/**
 * The Playlists list in the owner's own order (Custom), in any layout: each
 * playlist has a handle that drags it to a new place (scrolling the list near
 * its edges), across a grid's columns as well as down. A drop keeps the new
 * order at once, everywhere.
 */
export function ArrangeablePlaylists({
  playlists,
  layout,
  tile,
  rowHeight,
  selecting,
  header,
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
  const count = playlists.length;
  const rowCount = Math.ceil(count / columns);
  const idsRef = useRef<readonly number[]>([]);
  useLayoutEffect(() => {
    idsRef.current = playlists.map((playlist) => playlist.id);
  });

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  // The tab bar's second tap scrolls it to the top, as the other lists.
  useScrollToTop(scrollRef as unknown as RefObject<ScrollViewInstance>);
  const drag: DragState = {
    active: useSharedValue(-1),
    hover: useSharedValue(-1),
    dragX: useSharedValue(0),
    dragY: useSharedValue(0),
    translation: useSharedValue(0),
    fingerY: useSharedValue(0),
    startScroll: useSharedValue(0),
    scroll: useSharedValue(0),
  };
  useScrollOffset(scrollRef, drag.scroll);
  const contentHeight = useSharedValue(0);

  // Only the rows around the screen are mounted. Until laid out, the list is
  // assumed to fill the screen with nothing above it: too many rows, never too few.
  const { height: screenHeight } = useWindowDimensions();
  const [viewport, setViewport] = useState(screenHeight);
  const [top, setTop] = useState(0);
  const from = useRef(-1);
  const [shown, setShown] = useState<{
    readonly scroll: number;
    readonly rows: RowWindow;
    /** The row of the playlist being dragged, kept mounted. */
    readonly keep: number;
  }>({ scroll: 0, rows: { start: 0, end: 0 }, keep: -1 });
  const viewAt = useCallback(
    (scroll: number): RowView => ({ scroll, viewport, top, rowHeight, count: rowCount }),
    [viewport, top, rowHeight, rowCount],
  );
  const rows = rowWindow(viewAt(shown.scroll), shown.rows);
  const follow = useCallback(
    (scroll: number) =>
      setShown((previous) => {
        const current = rowWindow(viewAt(previous.scroll), previous.rows);
        const next = rowWindow(viewAt(scroll), current);
        const keep = from.current < 0 ? -1 : Math.floor(from.current / columns);
        return next === previous.rows ? previous : { scroll, rows: next, keep };
      }),
    [viewAt, columns],
  );
  // Checked every row scrolled; the window moves only now and then.
  useAnimatedReaction(
    () => Math.round(drag.scroll.get() / rowHeight),
    (step, previous) => {
      if (previous !== null && step !== previous) scheduleOnRN(follow, drag.scroll.get());
    },
    [follow, rowHeight],
  );
  const target = useRef(-1);
  const resetAfterRender = useRef(false);

  const endDrag = () => {
    drag.active.set(-1);
    drag.hover.set(-1);
    drag.dragX.set(0);
    drag.dragY.set(0);
  };

  // Playlists drop into place in the same frame the new order renders.
  useLayoutEffect(() => {
    if (!resetAfterRender.current) return;
    resetAfterRender.current = false;
    endDrag();
  });

  const onDragBegin = (index: number) => {
    from.current = index;
    target.current = index;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const onDragMove = (dx: number, dy: number) => {
    if (from.current < 0) return;
    const next = reorderGridTarget({
      from: from.current,
      dx,
      dy,
      cellWidth: cells.width,
      cellHeight: cells.height,
      columns,
      count: idsRef.current.length,
    });
    if (next === target.current) return;
    target.current = next;
    drag.hover.set(next);
    void Haptics.selectionAsync();
  };

  const onDrop = (canceled: boolean) => {
    const moved =
      !canceled &&
      from.current >= 0 &&
      moveShownPlaylist(idsRef.current, from.current, target.current);
    from.current = -1;
    target.current = -1;
    if (moved) resetAfterRender.current = true;
    else endDrag();
  };

  // Near the top or bottom edge, a dragged playlist scrolls the list, faster the closer it gets.
  useFrameCallback(() => {
    if (drag.active.get() === -1) return;
    const box = measure(scrollRef);
    if (box === null) return;
    const y = drag.fingerY.get() - box.pageY;
    const bottomZone = box.height - bottomInset - SCROLL_ZONE;
    let step = 0;
    if (y < SCROLL_ZONE) step = -SCROLL_STEP * Math.min(1, (SCROLL_ZONE - y) / SCROLL_ZONE);
    else if (y > bottomZone) step = SCROLL_STEP * Math.min(1, (y - bottomZone) / SCROLL_ZONE);
    if (step === 0) return;
    const max = Math.max(0, contentHeight.get() - box.height);
    const next = Math.min(max, Math.max(0, drag.scroll.get() + step));
    if (next === drag.scroll.get()) return;
    scrollTo(scrollRef, 0, next, false);
    drag.scroll.set(next);
    drag.dragY.set(drag.translation.get() + next - drag.startScroll.get());
    scheduleOnRN(onDragMove, drag.dragX.get(), drag.dragY.get());
  });

  const renderCell = (index: number) => {
    const playlist = playlists[index];
    if (playlist === undefined) return null;
    return (
      <ArrangeableCell
        key={playlist.id}
        index={index}
        cells={cells}
        layout={layout}
        drag={drag}
        selecting={selecting}
        onDragBegin={onDragBegin}
        onDragMove={onDragMove}
        onDrop={onDrop}
      >
        {renderPlaylist(playlist, index)}
      </ArrangeableCell>
    );
  };

  // The dragged playlist's row stays mounted however far auto-scroll takes the list.
  const indices = windowRows(rows, shown.keep).flatMap((row) =>
    Array.from({ length: columns }, (_, column) => row * columns + column),
  );

  return (
    <Animated.ScrollView
      scrollEnabled={scrollable}
      ref={scrollRef}
      className="flex-1"
      onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
      onContentSizeChange={(_, height) => contentHeight.set(height)}
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
    >
      <View onLayout={(event) => setTop(event.nativeEvent.layout.height)}>{header}</View>
      <View style={{ height: rowCount * rowHeight }}>{indices.map(renderCell)}</View>
    </Animated.ScrollView>
  );
}
