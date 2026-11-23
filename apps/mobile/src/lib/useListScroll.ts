import type { RefObject } from "react";
import type { ScrollView } from "react-native";
import {
  useAnimatedReaction,
  useAnimatedRef,
  useScrollOffset,
  useSharedValue,
  type AnimatedRef,
} from "react-native-reanimated";

import { usePageScroll } from "@/pageGradient/pageScroll";

/**
 * A list's scroll on the UI thread, from [initialOffset] (where it opens). The
 * list spreads [listProps]. It is the page's main list: its scroll also moves the
 * page-top gradient (`usePageScroll`).
 */
export const useListScroll = (initialOffset: number) => {
  const scrollRef = useAnimatedRef<ScrollView>();
  const scroll = useScrollOffset(scrollRef, useSharedValue(initialOffset));
  const pageScroll = usePageScroll();
  useAnimatedReaction(
    () => scroll.get(),
    (offset) => pageScroll?.set(offset),
  );
  const listRef = scrollRef as AnimatedRef<ScrollView> & RefObject<ScrollView | null>;
  return {
    scrollRef: listRef,
    scroll,
    listProps: { animated: true, refScrollView: listRef, scrollEventThrottle: 16 } as const,
  };
};
