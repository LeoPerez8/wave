import type { SheetStep } from "@wave/core";

/** The native adapter starts the close; the link runs on this same JS turn. */
export const followNowPlayingLink = (action: {
  readonly close: () => SheetStep;
  readonly navigate: () => void;
}): void => {
  if (action.close().navigateNow) action.navigate();
};
