import { stagedMounts } from "@wave/core";
import { Children, type ReactNode } from "react";
import { useWindowDimensions } from "react-native";

import { useStagedCount } from "@/lib/stagedCount";

/**
 * A scrolling page's sections, mounted across frames (#1355, Fluidity): the
 * first frame draws only the ones that start on screen, and each following
 * frame mounts about one screen more, so a push's first frame stays cheap and
 * what lies below is there before a scroll reaches it. `estimate` is a
 * section's height (or each one's, by index), erring short so the first frame
 * never leaves the bottom of the screen empty; `gap` is the room
 * the container puts between them. `viewport` is the window's height unless a
 * row that scrolls sideways passes its width.
 */
export function StagedSections({
  children,
  estimate,
  gap = 0,
  viewport,
}: {
  children: ReactNode;
  estimate: number | ((index: number) => number);
  gap?: number;
  viewport?: number;
}) {
  const { height } = useWindowDimensions();
  const sections = Children.toArray(children);
  const plan = stagedMounts({
    estimates: sections.map((_, index) =>
      typeof estimate === "number" ? estimate : estimate(index),
    ),
    viewport: viewport ?? height,
    gap,
  });
  return sections.slice(0, useStagedCount(plan));
}
