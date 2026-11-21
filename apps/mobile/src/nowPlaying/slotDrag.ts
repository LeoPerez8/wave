import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { usePanGesture } from "react-native-gesture-handler";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { OverlayRect } from "@wave/core";

import { measureRect, type Measurable } from "@/motion/measureRect";
import { handleHold } from "@/motion/handleHold";

import { slotRectsInFrame, slotUnderFinger } from "./slotHit";
import { slotTapGuard } from "./slotTapGuard";

type SlotDragState = {
  /** The slots' places in the sheet's frame, measured as the drag began; empty until then. */
  readonly rects: SharedValue<readonly (OverlayRect | null)[]>;
  readonly x: SharedValue<number>;
  readonly y: SharedValue<number>;
  readonly source: SharedValue<number>;
  readonly target: SharedValue<number>;
};

/**
 * Slot rectangles and finger position shared by the seven edit-slot gestures.
 * [sheet] is the view the dragged button's preview is drawn in: the slots are
 * measured against it.
 */
export function useNowPlayingSlotDrag(
  onDrop: (from: number, to: number) => void,
  sheet: RefObject<Measurable | null>,
) {
  const rects = useSharedValue<readonly (OverlayRect | null)[]>([]);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const source = useSharedValue(-1);
  const target = useSharedValue(-1);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  // The release that ends a drag doesn't also open the slot's card.
  const [tap] = useState(slotTapGuard);
  // The seven slots' views, measured with the sheet when a drag begins.
  const views = useRef<(Measurable | null)[]>(Array.from({ length: 7 }, () => null));
  // Which drag a measure belongs to, so one that lands after its drop writes nothing.
  const drags = useRef(0);

  const register = useCallback((slot: number, view: Measurable | null) => {
    views.current[slot] = view;
  }, []);
  const began = useCallback(
    (slot: number) => {
      tap.dragged(slot);
      setDragging(slot);
      // Measured now rather than at layout, so the places are where the slots are, and
      // written once: a JS write reaches the UI thread later, so seven writes that each
      // copied the array would keep only the last slot.
      const current = ++drags.current;
      void Promise.all([measureRect(sheet.current), ...views.current.map(measureRect)]).then(
        ([place, ...slots]) => {
          if (current === drags.current) rects.set(slotRectsInFrame(place, slots));
        },
      );
    },
    [tap, rects, sheet],
  );
  const hovered = useCallback((slot: number) => setDropTarget(slot < 0 ? null : slot), []);
  const dropped = useCallback(
    (from: number, to: number, canceled: boolean) => {
      drags.current += 1;
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
    /** Where slot [slot]'s view is (its ref). */
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
      rects.set([]);
      x.set(event.absoluteX);
      y.set(event.absoluteY);
      scheduleOnRN(drag.began, slot);
    },
    onUpdate: (event) => {
      "worklet";
      x.set(event.absoluteX);
      y.set(event.absoluteY);
      // The preview is drawn at the finger in the sheet's frame, so the slot under it
      // is the one that takes the drop.
      const over = slotUnderFinger(rects.get(), event.absoluteX, event.absoluteY);
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
