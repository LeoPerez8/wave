import { BackHandler } from "react-native";

import { dismissTopOverlay } from "./overlay";

/**
 * Android Back for a screen (closing a sheet instead of leaving, say). Use
 * this rather than `BackHandler`: an open card always takes Back first, even
 * over a screen that registered after the card opened. Closing cards consume
 * Back too, so repeated presses cannot reach the screen during the fade.
 * Returns the unsubscribe.
 */
export const addScreenBackHandler = (handler: () => boolean): (() => void) => {
  const subscription = BackHandler.addEventListener(
    "hardwareBackPress",
    () => dismissTopOverlay() || handler(),
  );
  return () => subscription.remove();
};
