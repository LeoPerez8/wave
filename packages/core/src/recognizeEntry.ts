/** Capture requests reuse an open card; notification matches replace it in the foreground. */
export const recognizeEntryAction = (state: {
  readonly pending: boolean;
  readonly opening: "capture" | "match";
  readonly foreground: boolean;
  readonly cardOpen: boolean;
}): "wait" | "open" | "keep" => {
  if (!state.pending || !state.foreground) return "wait";
  return state.cardOpen && state.opening !== "match" ? "keep" : "open";
};
