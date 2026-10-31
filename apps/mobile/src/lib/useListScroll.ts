import type { RefObject } from "react";
import type { ScrollView } from "react-native";
import {
  useAnimatedRef,
  useScrollOffset,
  useSharedValue,
  type AnimatedRef,
} from "react-native-reanimated";

/**
 * A list's scroll on the UI thread, from [initialOffset] (where it opens). The
 * list takes `animated`, `scrollRef` as its `refScrollView` and a
 * `scrollEventThrottle` of 16.
 */
export const useListScroll = (initialOffset: number) => {
  const scrollRef = useAnimatedRef<ScrollView>();
  const scroll = useScrollOffset(scrollRef, useSharedValue(initialOffset));
  return { scrollRef: scrollRef as AnimatedRef<ScrollView> & RefObject<ScrollView | null>, scroll };
};
