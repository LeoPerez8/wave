import { useEffect, useRef, useSyncExternalStore } from "react";

import { heldTouchStart, subscribeHeldTouch } from "./heldTouchState";
import { traceLongPress } from "./longPressTrace";

export {
  cancelHeldTouch,
  heldTouchStart,
  holdTouch,
  menuTouchOwnership,
  moveHeldTouch,
  observeMenuTouchOwnership,
  onHeldTouch,
  releaseHeldTouch,
} from "./heldTouchState";

/**
 * False while a long-pressed finger is held: pass it as a list's
 * `scrollEnabled`, so sliding onto a menu entry doesn't scroll the list
 * underneath (and take the touch away from the menu).
 */
export const useListScrollable = (): boolean => {
  const scrollable = useSyncExternalStore(subscribeHeldTouch, () => heldTouchStart() === null);
  const previous = useRef(scrollable);
  useEffect(() => {
    if (previous.current !== scrollable)
      traceLongPress(0, "list-scroll-prop-committed", `enabled=${scrollable}`);
    previous.current = scrollable;
  }, [scrollable]);
  return scrollable;
};
