/**
 * A state the Design preview opens straight into from a link,
 * `wave://design-preview?state=<name>`, so a screenshot taken over adb shows it
 * every time, without a finger on the phone.
 */
export interface DesignPreviewState {
  /** What the link calls it, e.g. "song-card-open". */
  readonly name: string;
  /** One line on what it shows. */
  readonly shows: string;
}

/**
 * The state a link's `state` query asks for, among [states] (a repeated `state`
 * asks for its first). A missing or unknown name opens none: the Design preview
 * as it always opens.
 */
export const designPreviewState = <S extends DesignPreviewState>(
  states: readonly S[],
  query: string | readonly string[] | undefined,
): S | undefined => {
  const name = typeof query === "string" ? query : query?.[0];
  return states.find((state) => state.name === name);
};
