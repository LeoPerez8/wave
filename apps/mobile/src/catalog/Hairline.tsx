import { overlayDivider } from "@wave/core";
import { createContext, useContext } from "react";
import { StyleSheet, View } from "react-native";

import { useThemeColor } from "@/theme/useThemeColor";

/**
 * True inside an overlay card (the overlay host provides it), where the
 * separator tone vanishes on glass: hairlines there draw the overlay divider.
 */
export const OnOverlayCard = createContext(false);

/** An overlay card's divider: a little thicker than a screen's hairline, still quiet. */
const OVERLAY_DIVIDER_WIDTH = StyleSheet.hairlineWidth * 2;

/**
 * A one-pixel rule in the separator tone. On an overlay card it becomes the
 * card's divider (a see-through wash of the text colour), so every card's
 * rules match and show on glass in any theme.
 */
export function Hairline({ className = "" }: { className?: string }) {
  const onCard = useContext(OnOverlayCard);
  const foreground = useThemeColor("foreground");
  if (onCard) {
    return (
      <View
        className={className}
        style={{
          height: OVERLAY_DIVIDER_WIDTH,
          backgroundColor: foreground.startsWith("#") ? overlayDivider(foreground) : foreground,
        }}
      />
    );
  }
  return (
    <View className={`bg-separator ${className}`} style={{ height: StyleSheet.hairlineWidth }} />
  );
}
