/** Entry requests wait for the foreground and reuse a card that is already open. */
export const recognizeEntryAction = (state: {
  readonly pending: boolean;
  readonly foreground: boolean;
  readonly cardOpen: boolean;
}): "wait" | "open" | "keep" => {
  if (!state.pending || !state.foreground) return "wait";
  return state.cardOpen ? "keep" : "open";
};
