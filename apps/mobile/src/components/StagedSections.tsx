import { stagedMounts, topDownMounts } from "@wave/core";
import { Children, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";

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
 *
 * `topDown` builds the page from the top down instead (#1487): after the
 * first screen, each section takes a frame of its own (Core's
 * `topDownMounts`), none of them before `waitFor` is true, and each one not
 * yet mounted keeps its estimated height empty, so a section arriving fills
 * room already there and moves nothing on screen.
 */
export function StagedSections({
  children,
  estimate,
  gap = 0,
  viewport,
  topDown = false,
  waitFor = true,
}: {
  children: ReactNode;
  estimate: number | ((index: number) => number);
  gap?: number;
  viewport?: number;
  topDown?: boolean;
  waitFor?: boolean;
}) {
  const { height } = useWindowDimensions();
  const sections = Children.toArray(children);
  const estimates = sections.map((_, index) =>
    typeof estimate === "number" ? estimate : estimate(index),
  );
  const input = { estimates, viewport: viewport ?? height, gap };
  const mounted = useStagedCount(topDown ? topDownMounts(input) : stagedMounts(input), !waitFor);
  if (!topDown) return sections.slice(0, mounted);
  const reserved = estimates.slice(mounted).reduce((sum, value) => sum + gap + value, 0);
  return (
    <>
      {sections.slice(0, mounted)}
      {reserved > 0 && <View style={{ height: reserved }} />}
    </>
  );
}
