/**
 * Now Playing stays mounted under the app and only moves: a tap on the mini
 * player starts its spring on that same frame. This decides, for each thing
 * that happens to the sheet, where it heads next and whether it has just gone
 * out of sight (so the app can hide it from touch and screen readers, put it
 * back on the player view and run whatever waited for the close).
 */

import type { SheetState } from "./sheet.ts";

/**
 * - `hidden`: out of sight below the screen.
 * - `open`: resting open or springing there.
 * - `drag`: following a swipe up from the mini player.
 * - `closing`: springing away.
 */
export type SheetPhase = "hidden" | "open" | "drag" | "closing";

export type SheetEvent =
  /** The mini player was tapped. */
  | { readonly type: "tap" }
  /** A swipe up on the mini player started moving the sheet. */
  | { readonly type: "dragBegin" }
  /** A finger let go of the sheet (from the mini player or a drag down); it settles here. */
  | { readonly type: "release"; readonly to: SheetState }
  /** The chevron, Back, or a link asked the sheet to go away. */
  | { readonly type: "close" }
  /** The closing spring reached the bottom. */
  | { readonly type: "closed" };

export interface SheetStep {
  readonly phase: SheetPhase;
  /**
   * Where to spring the sheet: `rise` jumps it just below the screen first,
   * `open` and `closed` carry on from wherever it is. `null` leaves it be.
   */
  readonly spring: "rise" | "open" | "closed" | null;
  /** The sheet has just gone out of sight. */
  readonly hidden: boolean;
}

const stay = (phase: SheetPhase): SheetStep => ({ phase, spring: null, hidden: false });

export const stepNowPlayingSheet = (phase: SheetPhase, event: SheetEvent): SheetStep => {
  switch (event.type) {
    case "tap":
      if (phase === "hidden") return { phase: "open", spring: "rise", hidden: false };
      if (phase === "closing") return { phase: "open", spring: "open", hidden: false };
      return stay(phase);
    case "dragBegin":
      // The sheet covers the mini player while it is open.
      return phase === "open" ? stay(phase) : stay("drag");
    case "release":
      if (phase === "hidden") return stay(phase);
      return event.to === "open"
        ? { phase: "open", spring: "open", hidden: false }
        : { phase: "closing", spring: "closed", hidden: false };
    case "close":
      if (phase === "hidden") return stay(phase);
      return { phase: "closing", spring: "closed", hidden: false };
    case "closed":
      if (phase !== "closing") return stay(phase);
      return { phase: "hidden", spring: null, hidden: true };
  }
};
