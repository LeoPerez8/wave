import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL } from "@/catalog/grid";

import { releaseNowPlaying, sheetOffset } from "./sheet";

/** Downward travel before the drag takes over from a tap, in dp. */
const DRAG_SLOP = CELL * 1.5;

/**
 * Part of Now Playing that drags the sheet down to dismiss it. Lists sit
 * outside it so they keep their own scrolling; controls inside it (the
 * scrubber) win when they claim the touch first.
 */
export function DismissArea({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const start = useSharedValue(0);
  const pan = usePanGesture({
    // Only a drag down claims the touch; up never does.
    activeOffsetY: [-1_000_000, DRAG_SLOP],
    failOffsetX: [-DRAG_SLOP * 2, DRAG_SLOP * 2],
    onActivate: () => {
      "worklet";
      start.set(sheetOffset.get());
    },
    onUpdate: (event) => {
      "worklet";
      sheetOffset.set(Math.max(0, start.get() + event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(
        releaseNowPlaying,
        Math.max(0, start.get() + event.translationY),
        event.velocityY,
      );
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}
