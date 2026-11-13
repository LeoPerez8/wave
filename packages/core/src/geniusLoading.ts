/** How long a Genius request must take before its loading note appears. */
export const GENIUS_LOADING_NOTE_DELAY_MS = 300;

/** The outcomes that can decide whether the Lyrics view has a Genius note. */
export type GeniusInsightState = "loading" | "settled" | "miss" | "failure";

/** Whether the Lyrics view should show its loading note for [state] after [elapsedMs]. */
export const geniusLoadingNote = (state: GeniusInsightState, elapsedMs: number): boolean =>
  state === "loading" && elapsedMs >= GENIUS_LOADING_NOTE_DELAY_MS;
