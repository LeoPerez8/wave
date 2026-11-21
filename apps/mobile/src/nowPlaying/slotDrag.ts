import { useCallback, useMemo, useState } from "react";
import { usePanGesture } from "react-native-gesture-handler";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import type { Measurable } from "@/motion/measureRect";
import { handleHold } from "@/motion/handleHold";

import { slotTapGuard } from "./slotTapGuard";

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};
type SlotDragState = {
  readonly rects: SharedValue<readonly (Rect | null)[]>;
  readonly x: SharedValue<number>;
  readonly y: SharedValue<number>;
  readonly source: SharedValue<number>;
  readonly target: SharedValue<number>;
};

/** Slot rectangles and finger position shared by the seven edit-slot gestures. */
export function useNowPlayingSlotDrag(onDrop: (from: number, to: number) => void) {
  const rects = useSharedValue<readonly (Rect | null)[]>(Array(7).fill(null));
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const source = useSharedValue(-1);
  const target = useSharedValue(-1);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  // The release that ends a drag doesn't also open the slot's card.
  const [tap] = useState(slotTapGuard);

  const register = useCallback(
    (slot: number, view: Measurable | null) => {
      if (view === null) return;
      view.measureInWindow((left, top, width, height) => {
        const next = [...rects.get()];
        next[slot] = { x: left, y: top, width, height };
        rects.set(next);
      });
    },
    [rects],
  );
  const began = useCallback(
    (slot: number) => {
      tap.dragged(slot);
      setDragging(slot);
    },
    [tap],
  );
  const hovered = useCallback((slot: number) => setDropTarget(slot < 0 ? null : slot), []);
  const dropped = useCallback(
    (from: number, to: number, canceled: boolean) => {
      setDragging(null);
      setDropTarget(null);
      if (!canceled && to >= 0 && to !== from) onDrop(from, to);
    },
    [onDrop],
  );

  const state = useMemo<SlotDragState>(
    () => ({ rects, x, y, source, target }),
    [rects, x, y, source, target],
  );
  return {
    state,
    dragging,
    dropTarget,
    register,
    began,
    hovered,
    dropped,
    /** A finger came down on a slot's button. */
    touched: tap.touched,
    /** The button's tap ended on [slot]: whether its card opens (not after a drag of it). */
    tapped: tap.tapped,
  };
}

/** A held edit slot follows the finger until it lands on one of the seven slots. */
export function useSlotDragGesture(drag: ReturnType<typeof useNowPlayingSlotDrag>, slot: number) {
  const { rects, x, y, source, target } = drag.state;
  const pan = usePanGesture({
    activateAfterLongPress: handleHold.activateAfterLongPress,
    minDistance: handleHold.minDistance,
    onActivate: (event) => {
      "worklet";
      source.set(slot);
      target.set(-1);
      x.set(event.absoluteX);
      y.set(event.absoluteY);
      scheduleOnRN(drag.began, slot);
    },
    onUpdate: (event) => {
      "worklet";
      x.set(event.absoluteX);
      y.set(event.absoluteY);
      const bounds = rects.get();
      let over = -1;
      for (let index = 0; index < bounds.length; index += 1) {
        const rect = bounds[index];
        if (rect == null) continue;
        if (
          event.absoluteX >= rect.x &&
          event.absoluteX <= rect.x + rect.width &&
          event.absoluteY >= rect.y &&
          event.absoluteY <= rect.y + rect.height
        ) {
          over = index;
          break;
        }
      }
      if (over !== target.get()) {
        target.set(over);
        scheduleOnRN(drag.hovered, over);
      }
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(drag.dropped, slot, target.get(), event.canceled);
      source.set(-1);
      target.set(-1);
    },
  });
  return pan;
}
