import * as Haptics from "expo-haptics";
import { useContext, useEffect, useEffectEvent, useState } from "react";

import { CELL } from "@/catalog/grid";
import { heldTouchStart, onHeldTouch } from "@/motion/heldTouch";
import { measureRect, type Measurable } from "@/motion/measureRect";
import { captureOverlayTouch, OverlayId } from "./overlay";
import { createSlideToChoose } from "./slideToChoose";

/** How far the held finger must slide before it chooses anything (Android's touch slop). */
const SLOP = CELL;

export interface SlideToChoose {
  /**
   * The entry lifting the held finger would run, by index, or undefined
   * (no finger held, it hasn't slid yet, or it's off every entry).
   */
  readonly underFinger: number | undefined;
  /** Ref callback for entry `index`'s outermost view. */
  readonly trackEntry: (index: number) => (node: Measurable | null) => void;
  /** Ref for the list holding the entries, where it scrolls inside the card. */
  readonly trackList: (node: Measurable | null) => void;
}

/**
 * Slide to choose, for a menu opened by a long-press: the finger still down
 * slides onto an entry (a selection tick as it moves onto each one), and
 * lifting it there calls `choose(index)`. Lifting it anywhere else (or
 * without sliding) leaves the menu open. Menus opened any other way (a tap, a
 * screen reader) see no held finger and work as before.
 */
export function useSlideToChoose(choose: (index: number) => void): SlideToChoose {
  const overlayId = useContext(OverlayId);
  const [underFinger, setUnderFinger] = useState<number | undefined>(undefined);
  const onChoose = useEffectEvent(choose);
  // The laid-out entries and their list, filled in by the ref callbacks.
  const [nodes] = useState(() => ({
    entries: new Map<number, Measurable>(),
    list: null as Measurable | null,
  }));

  const [refs] = useState(() => {
    const entryRefs = new Map<number, (node: Measurable | null) => void>();
    return {
      trackEntry: (index: number) => {
        let ref = entryRefs.get(index);
        if (ref === undefined) {
          ref = (node) => {
            if (node === null) nodes.entries.delete(index);
            else nodes.entries.set(index, node);
          };
          entryRefs.set(index, ref);
        }
        return ref;
      },
      trackList: (node: Measurable | null) => {
        nodes.list = node;
      },
    };
  });

  useEffect(() => {
    const start = heldTouchStart();
    if (start === null) return undefined;
    const measure = async () => {
      const count = Math.max(-1, ...nodes.entries.keys()) + 1;
      const [viewport, ...rects] = await Promise.all([
        measureRect(nodes.list),
        ...Array.from({ length: count }, (_, index) => measureRect(nodes.entries.get(index))),
      ]);
      return { entries: rects, viewport };
    };
    const slide = createSlideToChoose({
      start,
      slop: SLOP,
      measure,
      active: overlayId === undefined ? () => true : captureOverlayTouch(overlayId),
      highlight: setUnderFinger,
      tick: () => void Haptics.selectionAsync(),
      choose: onChoose,
    });
    const unsubscribe = onHeldTouch((event) => {
      slide.handle(event);
      if (event.type !== "move") unsubscribe();
    });

    return () => {
      unsubscribe();
      slide.cancel();
    };
  }, [nodes, overlayId]);

  return { underFinger, ...refs };
}
