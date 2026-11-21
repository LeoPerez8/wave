import type { OverlayRect } from "@wave/core";

/**
 * The edit slots' places in the sheet's own frame, the frame the dragged
 * button's preview is drawn in: each slot's window place less the sheet's.
 * Both come from one measure, so whatever offset the window frame has against
 * the gesture's coordinates cancels. A slot not laid out, or a sheet not
 * measured, has no place (null).
 */
export const slotRectsInFrame = (
  frame: OverlayRect | undefined,
  slots: readonly (OverlayRect | undefined)[],
): readonly (OverlayRect | null)[] =>
  slots.map((slot) =>
    frame === undefined || slot === undefined
      ? null
      : {
          left: slot.left - frame.left,
          top: slot.top - frame.top,
          right: slot.right - frame.left,
          bottom: slot.bottom - frame.top,
        },
  );

/**
 * The slot under the finger at ([x], [y]) in the sheet's frame, or -1 over
 * none. Runs on the UI thread on every move of a drag.
 */
export const slotUnderFinger = (
  slots: readonly (OverlayRect | null)[],
  x: number,
  y: number,
): number => {
  "worklet";
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (slot == null) continue;
    if (x >= slot.left && x <= slot.right && y >= slot.top && y <= slot.bottom) return index;
  }
  return -1;
};
