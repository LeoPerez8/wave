import { reorderShift, reorderTarget } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { handleHold } from "@/motion/handleHold";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * Dragging a row of a list up or down by its handle (the arrangement editors),
 * with every row mounted: the dragged row lifts and follows the finger, the
 * rows it passes step aside, and the drop hands its move to the list (Core's
 * `reorderTarget` / `reorderShift` decide where it lands). Rows may be of
 * different heights (large text): each reports its own. The drag lives in
 * shared values, so a long list doesn't render again as it passes rows.
 */

/** A 48dp target for a row's handle. */
const HANDLE = CELL * 6;

/** What every row of a list shares while one of them is dragged. */
export interface RowReorder<Id> {
  /** Whether a row is being dragged (changes only as one is picked up and dropped). */
  readonly dragging: boolean;
  /** The dragged row's index, or -1. */
  readonly from: SharedValue<number>;
  /** Where it would land if dropped now. */
  readonly to: SharedValue<number>;
  /** Its height: how far the rows it passes step aside. */
  readonly height: SharedValue<number>;
  /** Its travel since it was picked up. */
  readonly travel: SharedValue<number>;
  /** Reports a row's laid-out height. */
  readonly measure: (id: Id, height: number) => void;
  readonly pickUp: (index: number) => void;
  readonly dragTo: (distance: number) => void;
  readonly drop: (canceled: boolean) => void;
}

/** The drag as the gesture's callbacks last left it: the row dragged and the row it is over. */
type Dragging<Id> = {
  readonly from: number;
  readonly to: number;
  readonly id: Id;
  readonly over: Id;
};

/**
 * The drag machinery of the rows [ids] (in list order): [move] takes a drop
 * that changes the order, as the dragged row's place and where it lands among
 * the rows as they are at the drop (a row that left meanwhile drops nothing);
 * the rows land in place in the frame the new order renders. [rowHeight] is a
 * row's height until it reports one. The callbacks read [ids] and [move] as
 * they last rendered, so they stay the same while the list changes under
 * them (a journal notice): rows' gestures aren't rebuilt, or swapped mid-drag.
 */
export const useRowReorder = <Id,>({
  ids,
  rowHeight: assumed = grid.row,
  move,
}: {
  ids: readonly Id[];
  rowHeight?: number;
  move: (from: number, to: number) => void;
}): RowReorder<Id> => {
  const [dragging, setDragging] = useState(false);
  const from = useSharedValue(-1);
  const to = useSharedValue(-1);
  const height = useSharedValue(0);
  const travel = useSharedValue(0);
  const dragNow = useRef<Dragging<Id> | null>(null);
  const latest = useRef({ ids, move, assumed });
  useLayoutEffect(() => {
    latest.current = { ids, move, assumed };
  });
  // Each row's laid-out height, by row: large text makes rows taller, and unequal.
  const heights = useRef(new Map<Id, number>());
  const measure = useCallback((id: Id, laidOut: number) => {
    heights.current.set(id, laidOut);
  }, []);
  const heightOf = useCallback((id: Id | undefined) => {
    const fallback = latest.current.assumed;
    return id === undefined ? fallback : (heights.current.get(id) ?? fallback);
  }, []);

  // Rows drop into place in the same frame the new order renders.
  const resetAfterRender = useRef(false);
  useLayoutEffect(() => {
    if (!resetAfterRender.current) return;
    resetAfterRender.current = false;
    from.set(-1);
    to.set(-1);
    travel.set(0);
  });

  const pickUp = useCallback(
    (index: number) => {
      const id = latest.current.ids[index];
      if (id === undefined) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      dragNow.current = { from: index, to: index, id, over: id };
      height.set(heightOf(id));
      to.set(index);
      from.set(index);
      setDragging(true);
    },
    [from, to, height, heightOf],
  );
  const dragTo = useCallback(
    (distance: number) => {
      const current = dragNow.current;
      if (current === null) return;
      const rows = latest.current.ids;
      const next = reorderTarget({
        from: current.from,
        distance,
        rowHeight: rows.map(heightOf),
        count: rows.length,
      });
      if (next === current.to) return;
      void Haptics.selectionAsync();
      dragNow.current = { ...current, to: next, over: rows[next] ?? current.over };
      to.set(next);
    },
    [to, heightOf],
  );
  const drop = useCallback((canceled: boolean) => {
    const current = dragNow.current;
    dragNow.current = null;
    resetAfterRender.current = true;
    setDragging(false);
    if (current === null || canceled || current.over === current.id) return;
    const { ids: rows, move: moveNow } = latest.current;
    const start = rows.indexOf(current.id);
    const end = rows.indexOf(current.over);
    if (start !== -1 && end !== -1 && start !== end) moveNow(start, end);
  }, []);

  return useMemo(
    () => ({ dragging, from, to, height, travel, measure, pickUp, dragTo, drop }),
    [dragging, from, to, height, travel, measure, pickUp, dragTo, drop],
  );
};

/**
 * The row at [index] of a list using `useRowReorder`: its style (the dragged
 * row lifts on the fill colour and follows the finger; the others step aside
 * as it passes them), its hairline's, and its handle's gesture.
 */
export const useReorderRow = <Id,>({
  index,
  reorder: { from, to, height, travel, pickUp, dragTo, drop },
}: {
  index: number;
  reorder: RowReorder<Id>;
}) => {
  const fill = useThemeColor("fill");

  const style = useAnimatedStyle(() => {
    const dragged = from.get() === index;
    const shift =
      from.get() === -1 || dragged
        ? 0
        : reorderShift({ index, from: from.get(), to: to.get() }) * height.get();
    return {
      zIndex: dragged ? 1 : 0,
      backgroundColor: dragged ? fill : "transparent",
      transform: [{ translateY: dragged ? travel.get() : shift }],
    };
  });

  // A row's hairline hides while it's lifted, rather than going, so the row keeps its height.
  const underline = useAnimatedStyle(() => ({ opacity: from.get() === index ? 0 : 1 }));

  const handle = usePanGesture(
    useMemo(
      () => ({
        ...handleHold,
        onActivate: () => {
          "worklet";
          travel.set(0);
          scheduleOnRN(pickUp, index);
        },
        onUpdate: (event: { translationY: number }) => {
          "worklet";
          travel.set(event.translationY);
          scheduleOnRN(dragTo, event.translationY);
        },
        onDeactivate: (event: { canceled: boolean }) => {
          "worklet";
          scheduleOnRN(drop, event.canceled);
        },
      }),
      [travel, pickUp, dragTo, drop, index],
    ),
  );

  return { style, underline, handle };
};

/** The handle's three lines, as the 20dp menu icon draws them at stroke 1.5. */
const LINE = { width: 14.6, height: 1.25, borderRadius: 0.625 } as const;

/**
 * A drag handle's three lines, drawn with plain views rather than an SVG icon:
 * a list of hundreds of handles dispatches no SVG layout events (each one made
 * Reanimated flush its queued props on the main thread, #447).
 */
function HandleLines() {
  return (
    <View style={{ gap: 3.75 }}>
      <View className="bg-secondary" style={LINE} />
      <View className="bg-secondary" style={LINE} />
      <View className="bg-secondary" style={LINE} />
    </View>
  );
}

/**
 * A row's drag handle, as Up Next's: three lines in a 48dp target, at the
 * row's end. Screen readers move the row with its Move up / Move down actions
 * instead. With no [gesture] it's only drawn (a dragged row's lifted copy).
 */
export function ReorderHandle({ gesture }: { gesture?: ReturnType<typeof usePanGesture> }) {
  const handle = (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center"
      style={{ width: HANDLE, height: HANDLE, marginRight: -CELL * 1.5 }}
    >
      <HandleLines />
    </View>
  );
  return gesture === undefined ? (
    handle
  ) : (
    <GestureDetector gesture={gesture}>{handle}</GestureDetector>
  );
}

/** The room a row's handle takes, for rows that line up with draggable ones but have none. */
export const REORDER_HANDLE_ROOM = HANDLE - CELL * 1.5;
