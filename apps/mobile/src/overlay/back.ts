import { BackHandler } from "react-native";

import { hasOpenOverlay } from "./overlay";

/**
 * Android Back for a screen (closing a sheet instead of leaving, say). Use
 * this rather than `BackHandler`: an open card always takes Back first, even
 * over a screen that registered after the card opened, because this handler
 * steps aside while one is showing. Returns the unsubscribe.
 */
export const addScreenBackHandler = (handler: () => boolean): (() => void) => {
  const subscription = BackHandler.addEventListener(
    "hardwareBackPress",
    () => !hasOpenOverlay() && handler(),
  );
  return () => subscription.remove();
};
