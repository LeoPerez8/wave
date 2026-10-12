import { moveSlide, slideEntry, startSlide, type OverlayRect, type SlidePoint } from "@wave/core";
import { useEffect, useEffectEvent, useState } from "react";

import { CELL } from "@/catalog/grid";
import { heldTouchStart, onHeldTouch } from "@/motion/heldTouch";

/** How far the held finger must slide before it chooses anything (Android's touch slop). */
const SLOP = CELL;

interface Measurable {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

const measure = (node: Measurable | null | undefined): Promise<OverlayRect | undefined> =>
  node == null
    ? Promise.resolve(undefined)
    : new Promise((resolve) =>
        node.measureInWindow((x, y, width, height) =>
          resolve(
            width > 0 && height > 0
              ? { left: x, top: y, right: x + width, bottom: y + height }
              : undefined,
          ),
        ),
      );

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
 * slides onto an entry, and lifting it there calls `choose(index)`. Lifting it
 * anywhere else (or without sliding) leaves the menu open. Menus opened any
 * other way (a tap, a screen reader) see no held finger and work as before.
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
    const trackEntrys = new Map<number, (node: Measurable | null) => void>();
    return {
      trackEntry: (index: number) => {
        let ref = trackEntrys.get(index);
        if (ref === undefined) {
          ref = (node) => {
            if (node === null) nodes.entries.delete(index);
            else nodes.entries.set(index, node);
          };
          trackEntrys.set(index, ref);
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

    const entryAt = async (point: SlidePoint): Promise<number | undefined> => {
      const count = Math.max(-1, ...nodes.entries.keys()) + 1;
      const [viewport, ...rects] = await Promise.all([
        measure(nodes.list),
        ...Array.from({ length: count }, (_, index) => measure(nodes.entries.get(index))),
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
