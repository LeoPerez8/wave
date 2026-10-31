import { ANIMATED_SCREENS } from "./goToSuggestions.ts";

/**
 * The compact title beside a pushed page's Back (docs/spec.md "Compact title"):
 * when it shows and where tapping it takes the list.
 */

/**
 * Whether the compact title shows: once the list has scrolled past the large
 * title's [titleBottom] (in the list's content, infinite until measured), or
 * while a Find query has the head stepped aside. Runs on the UI thread, with
 * the scroll.
 */
export const compactTitleShown = ({
  scroll,
  titleBottom,
  querying,
}: {
  readonly scroll: number;
  readonly titleBottom: number;
  readonly querying: boolean;
}): boolean => {
  "worklet";
  return querying || scroll >= titleBottom;
};

/**
 * Where a tap takes the list: to where it opens ([openingOffset], past a
 * hidden field), or during a query to its very top, with the field holding the
 * query over the first result. Always animated but under reduce motion: from
 * further than an animated scroll covers without sweeping past blank rows, it
 * jumps close first ([jumpTo]), so thousands of songs don't sweep by.
 */
export const compactTitleScroll = ({
  scroll,
  openingOffset,
  querying,
  listHeight,
  reduceMotion,
}: {
  readonly scroll: number;
  readonly openingOffset: number;
  readonly querying: boolean;
  readonly listHeight: number;
  readonly reduceMotion: boolean;
}): {
  readonly jumpTo: number | null;
  readonly offset: number;
  readonly animated: boolean;
} => {
  const offset = querying ? 0 : openingOffset;
  if (reduceMotion) return { jumpTo: null, offset, animated: false };
  const reach = listHeight * ANIMATED_SCREENS;
  return {
    jumpTo: Math.abs(scroll - offset) > reach ? offset + reach : null,
    offset,
    animated: true,
  };
};
