/**
 * The version a screen shows, out of a version that keeps changing (the play
 * history, bumped on every play start and end). Tabs stay mounted, so a
 * hidden screen must not follow each change: it would re-run its queries for
 * nothing. A focused screen follows every change; a hidden one keeps what it
 * showed and catches up when it comes back. A screen covered by Now Playing
 * (a sheet over the app, so its route stays focused) counts as hidden.
 */

export interface FocusedVersion {
  /** The screen's route is the focused one. */
  readonly focused: boolean;
  /** Something drawn over the whole app (Now Playing) hides the screen. */
  readonly covered: boolean;
  /** The version the screen's data was read at. */
  readonly shown: number;
}

export type FocusedVersionEvent =
  | { readonly type: "focus"; readonly version: number }
  | { readonly type: "blur" }
  | { readonly type: "cover" }
  | { readonly type: "uncover"; readonly version: number }
  | { readonly type: "change"; readonly version: number };

/** A screen as it mounts: not focused yet, showing the current version. */
export const startFocusedVersion = (version: number): FocusedVersion => ({
  focused: false,
  covered: false,
  shown: version,
});

/** Whether the screen is in sight: focused and not covered. */
const inSight = (state: FocusedVersion): boolean => state.focused && !state.covered;

/** `next`, showing `version` if it's in sight; `state` itself when that changes nothing. */
const settle = (state: FocusedVersion, next: FocusedVersion, version: number): FocusedVersion => {
  const shown = inSight(next) ? version : next.shown;
  if (state.focused === next.focused && state.covered === next.covered && state.shown === shown) {
    return state;
  }
  return { ...next, shown };
};

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
      return settle(state, { ...state, focused: true }, event.version);
    case "blur":
      return settle(state, { ...state, focused: false }, state.shown);
    case "cover":
      return settle(state, { ...state, covered: true }, state.shown);
    case "uncover":
      return settle(state, { ...state, covered: false }, event.version);
    case "change":
      return settle(state, state, event.version);
  }
};
