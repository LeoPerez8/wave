import type { ReactNode } from "react";
import { ScrollView } from "react-native";

import { useListScrollable } from "@/motion/heldTouch";

import { CELL, grid } from "./grid";

/** Covers on a row leave the next one peeking in at the right edge, so the row reads as scrollable. */
export const COVER_ROW_TILE = CELL * 19;

/**
 * A row that scrolls sideways, edge to edge, inside a screen that keeps the
 * side margin: Home's and Discover's shelves and an artist page's album
 * shelves. Its tiles sit a gutter apart, the first one on the margin.
 */
export function CoverRow({ children }: { children: ReactNode }) {
  const scrollable = useListScrollable();
  return (
    <ScrollView
      scrollEnabled={scrollable}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -grid.margin }}
      contentContainerStyle={{ paddingHorizontal: grid.margin, gap: grid.gutter }}
    >
      {children}
    </ScrollView>
  );
}
