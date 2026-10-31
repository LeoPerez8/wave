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
 * list spreads [listProps].
 */
export const useListScroll = (initialOffset: number) => {
  const scrollRef = useAnimatedRef<ScrollView>();
  const scroll = useScrollOffset(scrollRef, useSharedValue(initialOffset));
  const listRef = scrollRef as AnimatedRef<ScrollView> & RefObject<ScrollView | null>;
  return {
    scrollRef: listRef,
    scroll,
    listProps: { animated: true, refScrollView: listRef, scrollEventThrottle: 16 } as const,
  };
};
