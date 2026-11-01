/** The travel an animated scroll covers without sweeping past blank rows, in list heights. */
const ANIMATED_SCREENS = 2;

/**
 * Where a scroll from [scroll] to [offset] jumps to first because it's too far to animate all the
 * way (as close as an animated scroll reaches), or null when it's near enough.
 */
export const jumpBeforeAnimating = ({
  scroll,
  offset,
  listHeight,
}: {
  readonly scroll: number;
  readonly offset: number;
  readonly listHeight: number;
}): number | null => {
  const reach = listHeight * ANIMATED_SCREENS;
  return Math.abs(scroll - offset) > reach ? offset + reach : null;
};
