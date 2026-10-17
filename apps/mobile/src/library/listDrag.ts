import {
  reorderGridShift,
  reorderGridTarget,
  reorderScrollSpeed,
  reorderTarget,
  rowWindow,
  windowRows,
  type RowView,
  type RowWindow,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { usePanGesture } from "react-native-gesture-handler";
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
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";

/**
 * Dragging an item of a list or a grid to a new place by its handle (a
 * playlist's songs, the Playlists list): the dragged item follows the finger,
 * the others step aside, the list scrolls near its edges, and only the rows
 * around the screen are mounted.
 */

/** How close to the top or bottom of the list the finger starts scrolling it. */
const SCROLL_ZONE = grid.row;
/** Fastest auto-scroll, in dp per frame, with the finger at the very edge. */
const SCROLL_STEP = CELL;
const SHIFT_MS = 120;

/** What every item shares while one of them is dragged. */
export interface DragState {
  /** The dragged item's index, or -1. */
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

/** Where the items sit: a cell per item, [columns] to a row. */
export interface DragCells {
  readonly columns: number;
  /** From one cell's left edge to the next one's, gutter included (more than one column). */
  readonly width: number;
  /** From one row's top to the next one's. */
  readonly height: number;
}

/** What a cell calls as its item is dragged. */
export interface DragHandlers {
  readonly onDragBegin: (index: number) => void;
  readonly onDragMove: (dx: number, dy: number) => void;
  readonly onDrop: (canceled: boolean) => void;
}

export interface ListDrag extends DragHandlers {
  readonly drag: DragState;
  /** The list's scroll view. */
  readonly scrollRef: AnimatedRef<Animated.ScrollView>;
  /** The scroll view's own layout and content size. */
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly onContentSizeChange: (width: number, height: number) => void;
  /** The layout of what sits above the items in the scroll view. */
  readonly onHeaderLayout: (event: LayoutChangeEvent) => void;
  /** The items to mount: the rows around the screen, and the dragged item's row. */
  readonly indices: readonly number[];
}

/**
 * The drag machinery of a list of [count] items laid out in [cells]: [move]
 * takes a drop (from, to), true once it reorders the items, which then land
 * in place in the frame the new order renders. [bottomInset] is the chrome
 * the list scrolls under.
 */
export const useListDrag = ({
  count,
  cells,
  bottomInset,
  move,
}: {
  count: number;
  cells: DragCells;
  bottomInset: number;
  move: (from: number, to: number) => boolean;
}): ListDrag => {
  const { columns } = cells;
  const rowHeight = cells.height;
  const rowCount = Math.ceil(count / columns);
  const countRef = useRef(count);
  const moveRef = useRef(move);
  useLayoutEffect(() => {
    countRef.current = count;
    moveRef.current = move;
  });

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
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

  // Only the rows around the screen are mounted, so a long list opens as fast
  // as a short one. Until laid out, the list is assumed to fill the screen
  // with nothing above it: that mounts too many rows, never too few.
  const { height: screenHeight } = useWindowDimensions();
  const [viewport, setViewport] = useState(screenHeight);
  const [top, setTop] = useState(0);
  const from = useRef(-1);
  // The window as of the last scroll that moved it, and the dragged item's row then.
  const [shown, setShown] = useState<{
    readonly scroll: number;
    readonly rows: RowWindow;
    readonly keep: number;
  }>({ scroll: 0, rows: { start: 0, end: 0 }, keep: -1 });
  const viewAt = useCallback(
    (scroll: number): RowView => ({ scroll, viewport, top, rowHeight, count: rowCount }),
    [viewport, top, rowHeight, rowCount],
  );
  // Layout and length changes apply at once; scrolling moves the window in `follow`.
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

  // Items drop into place in the same frame the new order renders.
  useLayoutEffect(() => {
    if (!resetAfterRender.current) return;
    resetAfterRender.current = false;
    endDrag();
  });

  const onDragMove = (dx: number, dy: number) => {
    if (from.current < 0) return;
    const next =
      columns === 1
        ? reorderTarget({
            from: from.current,
            distance: dy,
            rowHeight,
            count: countRef.current,
          })
        : reorderGridTarget({
            from: from.current,
            dx,
            dy,
            cellWidth: cells.width,
            cellHeight: rowHeight,
            columns,
            count: countRef.current,
          });
    if (next === target.current) return;
    target.current = next;
    drag.hover.set(next);
    void Haptics.selectionAsync();
  };

  // Near the top or bottom edge, the dragged item scrolls the list, faster the
  // closer the finger gets. It runs only while an item is dragged.
  const autoscroll = useFrameCallback(() => {
    if (drag.active.get() === -1) return;
    const box = measure(scrollRef);
    if (box === null) return;
    const step = reorderScrollSpeed({
      top: drag.fingerY.get() - box.pageY,
      rowHeight: 0,
      viewport: box.height - bottomInset,
      edge: SCROLL_ZONE,
      // Taken a frame at a time.
      maxSpeed: SCROLL_STEP,
    });
    if (step === 0) return;
    const max = Math.max(0, contentHeight.get() - box.height);
    const next = Math.min(max, Math.max(0, drag.scroll.get() + step));
    if (next === drag.scroll.get()) return;
    scrollTo(scrollRef, 0, next, false);
    drag.scroll.set(next);
    drag.dragY.set(drag.translation.get() + next - drag.startScroll.get());
    scheduleOnRN(onDragMove, drag.dragX.get(), drag.dragY.get());
  }, false);

  const onDragBegin = (index: number) => {
    from.current = index;
    target.current = index;
    autoscroll.setActive(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const onDrop = (canceled: boolean) => {
    autoscroll.setActive(false);
    const moved = !canceled && from.current >= 0 && moveRef.current(from.current, target.current);
    from.current = -1;
    target.current = -1;
    if (moved) resetAfterRender.current = true;
    else endDrag();
  };

  // The dragged item's row stays mounted however far auto-scroll takes the list.
  const indices = windowRows(rows, shown.keep).flatMap((row) =>
    Array.from({ length: columns }, (_, column) => row * columns + column),
  );

  return {
    drag,
    scrollRef,
    onLayout: (event) => setViewport(event.nativeEvent.layout.height),
    onContentSizeChange: (_, height) => contentHeight.set(height),
    onHeaderLayout: (event) => setTop(event.nativeEvent.layout.height),
    indices,
    onDragBegin,
    onDragMove,
    onDrop,
  };
};

/**
 * The item at [index] of a list using `useListDrag`: its cell's style (the
 * dragged item follows the finger, on [liftedColor] if given; the others step
 * aside, back or on one place, as it passes them) and its handle's gesture,
 * off while [enabled] is false.
 */
export const useDragCell = ({
  drag,
  index,
  cells,
  enabled,
  liftedColor,
  handlers: { onDragBegin, onDragMove, onDrop },
}: {
  drag: DragState;
  index: number;
  cells: DragCells;
  enabled: boolean;
  liftedColor: string | undefined;
  handlers: DragHandlers;
}) => {
  const reduceMotion = useReducedMotion();
  const { active, hover, dragX, dragY, translation, fingerY, startScroll, scroll } = drag;
  const { columns, width, height } = cells;

  // Other items make way for the dragged one.
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

  const style = useAnimatedStyle(() => {
    const dragged = active.get() === index;
    return {
      zIndex: dragged ? 1 : 0,
      backgroundColor: dragged && liftedColor !== undefined ? liftedColor : "transparent",
      transform: [
        { translateX: dragged ? dragX.get() : shiftX.get() },
        { translateY: dragged ? dragY.get() : shiftY.get() },
      ],
    };
  });

  const grip = usePanGesture({
    enabled,
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

  return { style, grip };
};
