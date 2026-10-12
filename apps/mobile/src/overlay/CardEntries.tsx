import { useEffect, useRef, type ReactNode } from "react";
import { ScrollView, View, type ScrollViewInstance } from "react-native";

import type { Measurable } from "@/motion/measureRect";

import { useOverlayFlow } from "./flow";

type Props = {
  /** The entries in their logical order, first one first (screen readers read them so). */
  children: ReactNode;
  /** Ref for the list's viewport, e.g. slide to choose's `trackList`. */
  listRef?: ((node: Measurable | null) => void) | undefined;
};

/**
 * A card's list of choices, run from the edge nearest the finger that opened
 * it: top down, or bottom up when the card opened above the finger (give each
 * entry its hairline with Core `entryDivider`). Scrolls only where the card
 * can't fit every entry (small windows, landscape), and then opens scrolled
 * to the first entry.
 */
export function CardEntries({ children, listRef }: Props) {
  const up = useOverlayFlow() === "up";
  const scroll = useRef<ScrollViewInstance>(null);
  const showFirst = () => {
    if (up) scroll.current?.scrollToEnd({ animated: false });
  };

  useEffect(() => {
    if (up) scroll.current?.scrollToEnd({ animated: false });
  }, [up]);

  return (
    <View ref={listRef} collapsable={false} style={{ flexShrink: 1 }}>
      <ScrollView
        ref={scroll}
        bounces={false}
        overScrollMode="never"
        // Reversed on screen only: the views (and so screen readers) keep the logical order.
        contentContainerStyle={up ? { flexDirection: "column-reverse" } : undefined}
        onLayout={showFirst}
        onContentSizeChange={showFirst}
      >
        {children}
      </ScrollView>
    </View>
  );
}
