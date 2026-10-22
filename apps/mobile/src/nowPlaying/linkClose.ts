import type { SheetEvent, SheetStep } from "@wave/core";

/** The native adapter starts the close; the link runs on this same JS turn. */
export const followNowPlayingLink = (action: {
  readonly step: (event: SheetEvent) => SheetStep;
  readonly navigate: () => void;
}): void => {
  if (action.step({ type: "linkClose" }).navigateNow) action.navigate();
};
