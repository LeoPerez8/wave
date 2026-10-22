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
 * - `opening`: springing open.
 * - `open`: resting open.
 * - `drag`: following a swipe up from the mini player.
 * - `closing`: springing away.
 */
export type SheetPhase = "hidden" | "opening" | "open" | "drag" | "closing";

export type SheetEvent =
  /** The mini player was tapped. */
  | { readonly type: "tap" }
  /** A swipe up on the mini player started moving the sheet. */
  | { readonly type: "dragBegin" }
  /** A finger let go of the sheet (from the mini player or a drag down); it settles here. */
  | { readonly type: "release"; readonly to: SheetState }
  /** A link opens its destination immediately, while the sheet closes. */
  | { readonly type: "linkClose" }
  /** The chevron, Back, or a card asked the sheet to go away. */
  | { readonly type: "close" }
  /** The opening spring reached the top. */
  | { readonly type: "opened" }
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
  /** Only this event owns navigation; spring completion never replays it. */
  readonly navigateNow?: true;
}

const stay = (phase: SheetPhase): SheetStep => ({ phase, spring: null, hidden: false });

export const stepNowPlayingSheet = (phase: SheetPhase, event: SheetEvent): SheetStep => {
  switch (event.type) {
    case "tap":
      if (phase === "hidden") return { phase: "opening", spring: "rise", hidden: false };
      if (phase === "closing") return { phase: "opening", spring: "open", hidden: false };
      return stay(phase);
    case "dragBegin":
      // The sheet covers the mini player while it is open.
      return phase === "open" || phase === "opening" ? stay(phase) : stay("drag");
    case "release":
      if (phase === "hidden") return stay(phase);
      return event.to === "open"
        ? { phase: "opening", spring: "open", hidden: false }
        : { phase: "closing", spring: "closed", hidden: false };
    case "linkClose":
      return {
        phase: phase === "hidden" ? "hidden" : "closing",
        spring: phase === "hidden" ? null : "closed",
        hidden: false,
        navigateNow: true,
      };
    case "close":
      if (phase === "hidden") return stay(phase);
      return { phase: "closing", spring: "closed", hidden: false };
    case "opened":
      return phase === "opening" ? stay("open") : stay(phase);
    case "closed":
      if (phase !== "closing") return stay(phase);
      return { phase: "hidden", spring: null, hidden: true };
  }
};
