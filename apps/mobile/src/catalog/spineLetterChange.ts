import type { IndexEntry, SpineLayout } from "@wave/core";

/** Runs on the UI thread. Neighboring empty slots can point at the same letter. */
export const spineLetterChange = (
  layout: SpineLayout,
  y: number,
  previous: string | null,
): IndexEntry | undefined => {
  "worklet";
  if (layout.slotHeight <= 0 || layout.slots.length === 0) return undefined;
  const index = Math.min(layout.slots.length - 1, Math.max(0, Math.floor(y / layout.slotHeight)));
  const target = layout.slots[index]?.target;
  return target?.letter === previous ? undefined : target;
};
