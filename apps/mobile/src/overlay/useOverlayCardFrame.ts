import { placeOverlayCard, type OverlayCardInput } from "@wave/core";
import { useState } from "react";

/** Place a card while it is open and retain that frame during its fade-out. */
export const useOverlayCardFrame = (input: OverlayCardInput, closing: boolean) => {
  const next = placeOverlayCard(input);
  const [frame, setFrame] = useState(next);
  if (
    !closing &&
    (next.left !== frame.left ||
      next.top !== frame.top ||
      next.width !== frame.width ||
      next.maxHeight !== frame.maxHeight ||
      next.side !== frame.side ||
      next.flow !== frame.flow)
  ) {
    setFrame(next);
    return next;
  }
  return frame;
};
