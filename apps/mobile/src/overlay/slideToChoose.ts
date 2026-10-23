import {
  moveSlide,
  slideEntry,
  slideTicks,
  startSlide,
  type OverlayRect,
  type SlidePoint,
} from "@wave/core";

import type { HeldTouchEvent } from "../motion/heldTouchState.ts";

/** The held-touch event consumer used by menu cards; native measurements may finish later. */
export const createSlideToChoose = ({
  start,
  slop,
  measure,
  active,
  highlight,
  tick,
  choose,
}: {
  start: SlidePoint;
  slop: number;
  measure: () => Promise<{
    entries: readonly (OverlayRect | undefined)[];
    viewport?: OverlayRect | undefined;
  }>;
  active: () => boolean;
  highlight: (index: number | undefined) => void;
  tick: () => void;
  choose: (index: number) => void;
}) => {
  let slide = startSlide(start);
  let latest = 0;
  let ended = false;
  let under: number | undefined;

  const cancel = () => {
    ended = true;
    latest += 1;
    highlight(undefined);
  };

  return {
    cancel,
    handle: (event: HeldTouchEvent): void => {
      if (event.type === "cancel") {
        cancel();
        return;
      }
      if (ended) return;
      const ticket = ++latest;
      slide = moveSlide(slide, event.point, slop);
      const atEvent = slide;
      if (event.type === "release") {
        ended = true;
        highlight(undefined);
      }
      void measure().then(({ entries, viewport }) => {
        if (ticket !== latest || !active()) return;
        const index = slideEntry(atEvent, event.point, entries, viewport);
        if (event.type === "move") {
          if (slideTicks(under, index)) tick();
          under = index;
          highlight(index);
        } else if (index !== undefined) {
          choose(index);
        }
      });
    },
  };
};
