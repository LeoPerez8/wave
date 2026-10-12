import { moveSlide, slideEntry, slideTicks, startSlide, type SlidePoint } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useEffect, useEffectEvent, useState } from "react";

import { CELL } from "@/catalog/grid";
import { heldTouchStart, onHeldTouch } from "@/motion/heldTouch";
import { measureRect, type Measurable } from "@/motion/measureRect";

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
    let slide = startSlide(start);
    let live = true;
    // Moves resolve in order; one that lands after the finger lifted is dropped.
    let latest = 0;
    // The entry under the finger as of the last move, for the haptic tick onto a new one.
    let under: number | undefined;

    const entryAt = async (point: SlidePoint): Promise<number | undefined> => {
      const count = Math.max(-1, ...nodes.entries.keys()) + 1;
      const [viewport, ...rects] = await Promise.all([
        measureRect(nodes.list),
        ...Array.from({ length: count }, (_, index) => measureRect(nodes.entries.get(index))),
      ]);
      return slideEntry(slide, point, rects, viewport);
    };

    const unsubscribe = onHeldTouch((event) => {
      const ticket = ++latest;
      if (event.type === "cancel") {
        unsubscribe();
        setUnderFinger(undefined);
        return;
      }
      slide = moveSlide(slide, event.point, SLOP);
      if (event.type === "release") unsubscribe();
      void entryAt(event.point).then((index) => {
        if (!live || ticket !== latest) return;
        if (event.type === "move") {
          if (slideTicks(under, index)) void Haptics.selectionAsync();
          under = index;
          setUnderFinger(index);
          return;
        }
        setUnderFinger(undefined);
        if (index !== undefined) onChoose(index);
      });
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, [nodes]);

  return { underFinger, ...refs };
}
