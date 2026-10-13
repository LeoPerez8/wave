/**
 * The version a screen shows, out of a version that keeps changing (the play
 * history, bumped on every play start and end). Tabs stay mounted, so a
 * hidden screen must not follow each change: it would re-run its queries for
 * nothing. A focused screen follows every change; a hidden one keeps what it
 * showed and catches up when it comes back.
 */

export interface FocusedVersion {
  readonly focused: boolean;
  /** The version the screen's data was read at. */
  readonly shown: number;
}

export type FocusedVersionEvent =
  | { readonly type: "focus"; readonly version: number }
  | { readonly type: "blur" }
  | { readonly type: "change"; readonly version: number };

/** A screen as it mounts: not focused yet, showing the current version. */
export const startFocusedVersion = (version: number): FocusedVersion => ({
  focused: false,
  shown: version,
});

/**
 * The state after `event`. Returns `state` itself when nothing the screen
 * shows changes, so a caller holding it in React state doesn't re-render.
 */
export const focusedVersion = (
  state: FocusedVersion,
  event: FocusedVersionEvent,
): FocusedVersion => {
  switch (event.type) {
    case "focus":
      return state.focused && state.shown === event.version
        ? state
        : { focused: true, shown: event.version };
    case "blur":
      return state.focused ? { ...state, focused: false } : state;
    case "change":
      return state.focused && state.shown !== event.version
        ? { ...state, shown: event.version }
        : state;
  }
};
