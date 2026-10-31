import { jumpBeforeAnimating } from "./animatedScroll.ts";
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

/** How long the pill stays after the list stops. */
export const GO_TO_SUGGESTIONS_WAIT_MS = 2000;

/**
 * The pill's life around the owner's scrolling: "dragging" with a finger on the list,
 * "gliding" from the finger lifting until the wait ends (each scroll restarts that
 * wait), "tapped" for what's left of the wait after a tap, whose scroll doesn't count.
 */
export type GoToSuggestionsPill = "hidden" | "dragging" | "gliding" | "tapped";

export type GoToSuggestionsPillEvent =
  "dragStarted" | "dragEnded" | "scrolled" | "waited" | "tapped";

/**
 * The phase after [event]. Only a drag starts it: the list moving on its own (the
 * opening, a tap's scroll) never shows the pill. Runs on the UI thread, with the scroll.
 */
export const goToSuggestionsPillAfter = (
  phase: GoToSuggestionsPill,
  event: GoToSuggestionsPillEvent,
): GoToSuggestionsPill => {
  "worklet";
  if (event === "dragStarted") return "dragging";
  if (event === "dragEnded") return phase === "dragging" ? "gliding" : phase;
  if (event === "tapped") return phase === "gliding" ? "tapped" : phase;
  if (event === "waited") return phase === "dragging" ? phase : "hidden";
  return phase;
};

/** Whether the pill shows: during a [phase] with a scroll to answer, the section still [place]d away. */
export const goToSuggestionsPillShown = (
  phase: GoToSuggestionsPill,
  place: ReturnType<typeof playlistSuggestionsPlace>,
): boolean => {
  "worklet";
  return phase !== "hidden" && place === "away";
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
  animated: !reduceMotion && jumpBeforeAnimating({ scroll, offset: top, listHeight }) === null,
});
