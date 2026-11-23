import type { ReactNode } from "react";
import { ScrollView, useWindowDimensions } from "react-native";

import { StagedSections } from "@/components/StagedSections";

import { useListScrollable } from "@/motion/heldTouch";

import { CELL, grid } from "./grid";

/** Covers on a row leave the next one peeking in at the right edge, so the row reads as scrollable. */
export const COVER_ROW_TILE = CELL * 19;

/**
 * A row that scrolls sideways, edge to edge, inside a screen that keeps the
 * side margin: Home's shelves and an artist page's album
 * shelves. Its tiles sit a gutter apart, the first one on the margin.
 * `staged` mounts only the tiles on screen in its first frame and the rest in
 * the frames after (#1355), for rows of `COVER_ROW_TILE` tiles unless `tile`
 * gives their width.
 */
export function CoverRow({
  children,
  staged = false,
  tile = COVER_ROW_TILE,
}: {
  children: ReactNode;
  staged?: boolean;
  tile?: number;
}) {
  const scrollable = useListScrollable();
  const { width } = useWindowDimensions();
  return (
    <ScrollView
      scrollEnabled={scrollable}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -grid.margin }}
      contentContainerStyle={{ paddingHorizontal: grid.margin, gap: grid.gutter }}
    >
      {staged ? (
        <StagedSections estimate={tile} gap={grid.gutter} viewport={width}>
          {children}
        </StagedSections>
      ) : (
        children
      )}
    </ScrollView>
  );
}
