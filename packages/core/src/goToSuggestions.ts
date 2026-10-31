import type { PlaylistRecommendationState } from "./playlistRecommendationSession.ts";

/**
 * Where a playlist's suggestions section sits against the list's visible part,
 * and how the Go to Suggestions pill gets there. The section's top comes from the
 * known row heights, since a long playlist's section may not be mounted yet.
 */

/**
 * "inSight" once the section's [top] reaches above the floating chrome (the
 * [bottomInset] over the list's bottom), "away" while it's below that, and
 * "unknown" with no section ([top] infinite) or a list not laid out yet. Runs on
 * the UI thread, with the scroll.
 */
export const playlistSuggestionsPlace = ({
  top,
  scroll,
  listHeight,
  bottomInset,
}: {
  readonly top: number;
  readonly scroll: number;
  readonly listHeight: number;
  readonly bottomInset: number;
}): "unknown" | "away" | "inSight" => {
  "worklet";
  if (listHeight <= 0 || top === Number.POSITIVE_INFINITY) return "unknown";
  return top < scroll + listHeight - bottomInset ? "inSight" : "away";
};

/**
 * Whether the section has anything to go to: offers, or a slot being replaced, a
 * reload or a failure line. With none of those it only says there's no more.
 */
export const goToSuggestionsOffered = (
  state: Pick<
    PlaylistRecommendationState,
    "slots" | "loading" | "pendingSlots" | "unfilled" | "error"
  >,
): boolean =>
  state.loading ||
  state.error !== null ||
  state.pendingSlots.length > 0 ||
  state.unfilled.length > 0 ||
  state.slots.some((slot) => slot !== null);

/** The travel an animated scroll covers without sweeping past blank rows, in list heights. */
export const ANIMATED_SCREENS = 2;

/**
 * Where a tap takes the list, the section's [top] at the list's top (the list
 * stops short of that at its end): animated when near, a jump when far, so a
 * playlist of thousands of songs doesn't sweep by. Under reduce motion, always a jump.
 */
export const goToSuggestionsScroll = ({
  top,
  scroll,
  listHeight,
  reduceMotion,
}: {
  readonly top: number;
  readonly scroll: number;
  readonly listHeight: number;
  readonly reduceMotion: boolean;
}): { readonly offset: number; readonly animated: boolean } => ({
  offset: top,
  animated: !reduceMotion && Math.abs(top - scroll) <= listHeight * ANIMATED_SCREENS,
});
