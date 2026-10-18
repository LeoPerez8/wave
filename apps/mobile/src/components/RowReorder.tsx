import { IconMenu2 } from "@tabler/icons-react-native";
import { reorderShift, reorderTarget } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * Dragging a row of a short list up or down by its handle (the arrangement
 * editors, Settings › Downloads' groups and songs), with every row mounted:
 * the dragged row lifts and follows the finger, the rows it passes step
 * aside, and the drop hands its move to the list (Core's `reorderTarget` /
 * `reorderShift` decide where it lands). Rows may be of different heights
 * (large text, a group's songs): each reports its own.
 */

/** A 48dp target for a row's handle. */
const HANDLE = CELL * 6;

/**
 * The drag going on among the rows: from where, to where it would land, and
 * the dragged row's height (how far the rows it passes step aside).
 */
export type RowDrag = { readonly from: number; readonly to: number; readonly height: number };

/** What every row of a list shares while one of them is dragged. */
export interface RowReorder<Id> {
  readonly drag: RowDrag | null;
  /** The dragged row's travel since it was picked up. */
  readonly travel: SharedValue<number>;
  /** Reports a row's laid-out height. */
  readonly measure: (id: Id, height: number) => void;
  readonly pickUp: (index: number) => void;
  readonly dragTo: (distance: number) => void;
  readonly drop: (canceled: boolean) => void;
}

/** The drag as the gesture's callbacks last left it, with the rows it is between. */
type Dragging<Id> = RowDrag & { readonly id: Id; readonly over: Id };

/**
 * The drag machinery of the rows [ids] (in list order): [move] takes a drop
 * that changes the order, as the dragged row's place and where it lands among
 * the rows as they are at the drop (a row that left meanwhile drops nothing).
 * [rowHeight] is a row's height until it reports one.
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
  const [drag, setDrag] = useState<Dragging<Id> | null>(null);
  // The drag as the gesture's callbacks last left it, ahead of a render.
  const dragNow = useRef<Dragging<Id> | null>(null);
  const travel = useSharedValue(0);
  // Each row's laid-out height, by row: large text makes rows taller, and unequal.
  const heights = useRef(new Map<Id, number>());
  const measure = useCallback((id: Id, height: number) => {
    heights.current.set(id, height);
  }, []);
  const heightOf = useCallback(
    (id: Id | undefined) => (id === undefined ? assumed : (heights.current.get(id) ?? assumed)),
    [assumed],
  );

  const follow = useCallback((next: Dragging<Id> | null) => {
    dragNow.current = next;
    setDrag(next);
  }, []);
  const pickUp = useCallback(
    (from: number) => {
      const id = ids[from];
      if (id === undefined) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      follow({ from, to: from, height: heightOf(id), id, over: id });
    },
    [follow, heightOf, ids],
  );
  const dragTo = useCallback(
    (distance: number) => {
      const current = dragNow.current;
      if (current === null) return;
      const to = reorderTarget({
        from: current.from,
        distance,
        rowHeight: ids.map(heightOf),
        count: ids.length,
      });
      if (to === current.to) return;
      void Haptics.selectionAsync();
      follow({ ...current, to, over: ids[to] ?? current.over });
    },
    [follow, heightOf, ids],
  );
  const drop = useCallback(
    (canceled: boolean) => {
      const current = dragNow.current;
      if (current !== null && !canceled && current.over !== current.id) {
        const from = ids.indexOf(current.id);
        const to = ids.indexOf(current.over);
        if (from !== -1 && to !== -1 && from !== to) move(from, to);
      }
      follow(null);
      travel.set(0);
    },
    [follow, ids, move, travel],
  );

  return { drag, travel, measure, pickUp, dragTo, drop };
};

/**
 * The row at [index] of a list using `useRowReorder`: its style (the dragged
 * row lifts on the fill colour and follows the finger; the others step aside
 * as it passes them) and its handle's gesture.
 */
export const useReorderRow = <Id,>({
  index,
  reorder: { drag, travel, pickUp, dragTo, drop },
}: {
  index: number;
  reorder: RowReorder<Id>;
}) => {
  const fill = useThemeColor("fill");
  const dragged = drag?.from === index;
  const shift = drag === null || dragged ? 0 : reorderShift({ index, ...drag }) * drag.height;

  const moving = useAnimatedStyle(() => ({
    transform: [{ translateY: dragged ? travel.get() : shift }],
  }));

  const handle = usePanGesture(
    useMemo(
      () => ({
        minDistance: 0,
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

  const style = [
    { zIndex: dragged ? 1 : 0, backgroundColor: dragged ? fill : "transparent" },
    moving,
  ];
  return { dragged, style, handle };
};

/**
 * A row's drag handle, as Up Next's: three lines in a 48dp target, at the
 * row's end. Screen readers move the row with its Move up / Move down actions
 * instead.
 */
export function ReorderHandle({ gesture }: { gesture: ReturnType<typeof usePanGesture> }) {
  const secondary = useThemeColor("secondary");
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="items-center justify-center"
        style={{ width: HANDLE, height: HANDLE, marginRight: -CELL * 1.5 }}
      >
        <IconMenu2 size={20} color={secondary} strokeWidth={1.5} />
      </View>
    </GestureDetector>
  );
}

/** The room a row's handle takes, for rows that line up with draggable ones but have none. */
export const REORDER_HANDLE_WIDTH = HANDLE - CELL * 1.5;
