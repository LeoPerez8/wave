import type { OverlayFlow } from "@wave/core";
import { createContext, useContext } from "react";

/** Which way the entries of the card being drawn run (see Core `placeOverlayCard`). */
export const OverlayFlowContext = createContext<OverlayFlow>("down");

/**
 * Which way this card's entries run: "down" from its top edge, or "up" from
 * its bottom edge when it opened above the finger, so the first entry is
 * always nearest it.
 */
export const useOverlayFlow = (): OverlayFlow => useContext(OverlayFlowContext);
