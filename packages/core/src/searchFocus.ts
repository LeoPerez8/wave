/**
 * Search's field focus: tapping the Search tab raises the keyboard from that
 * one tap, on a first visit (the tap mounts the screen) and a warm one alike.
 *
 * The tap asks for the field. The field is focused on the first animation
 * frame where the screen is in sight and the field is laid out. A request is
 * done once the field has the focus and the keyboard is up, not on the focus
 * alone: Android takes (and reports) the focus of a field its window doesn't
 * serve yet, a field still being attached, and ignores the keyboard asked
 * for with it; and Back puts the keyboard away without blurring the field.
 * So a request is asked again, a few times at most, spaced out: soon when
 * the field doesn't report the focus, later when it does and the keyboard
 * doesn't come. Leaving Search cancels whatever is pending and blurs the
 * field, and a request the screen doesn't show up for in time is dropped, so
 * the keyboard never comes up late or after Search was left.
 */

export interface SearchFocusLimits {
  /** How long a tap's request waits for the screen and its field before it is dropped. */
  readonly waitMs: number;
  /** How long a focus has to be reported before it is asked again. */
  readonly retryMs: number;
  /** How long the keyboard has to come up for a focus the field reported before it is asked again. */
  readonly keyboardMs: number;
  /** How many times the field is asked to focus for one request, the first included. */
  readonly attempts: number;
}

export const SEARCH_FOCUS_LIMITS: SearchFocusLimits = {
  waitMs: 2000,
  retryMs: 150,
  keyboardMs: 600,
  attempts: 3,
};

export interface SearchFocusState {
  /** The Search screen is in sight. */
  readonly shown: boolean;
  /** The field has been laid out (it is in the window). */
  readonly attached: boolean;
  /** The field reports it has the focus. */
  readonly hasFocus: boolean;
  /** The keyboard is up. */
  readonly keyboard: boolean;
  /** A tap's request, until the field has the focus with the keyboard up, or the request is dropped. */
  readonly request: {
    /** When the tab was tapped. */
    readonly at: number;
    /** Focus commands given for it so far. */
    readonly attempts: number;
    /** When the last one was given. */
    readonly lastAt: number;
  } | null;
}

export type SearchFocusEvent =
  /** The Search tab was tapped, at [at] (the frames' clock). */
  | { readonly type: "requested"; readonly at: number }
  /** The screen came into sight. */
  | { readonly type: "shown" }
  /** The screen went out of sight (another tab, a pushed screen). */
  | { readonly type: "hidden" }
  /** The field was laid out. */
  | { readonly type: "attached" }
  /** The field reports it took the focus (the keyboard may still not come). */
  | { readonly type: "focused" }
  /** The field reports it lost the focus. */
  | { readonly type: "blurred" }
  /** The keyboard came up. */
  | { readonly type: "keyboardShown" }
  /** The keyboard went down (Back puts it away and leaves the field focused). */
  | { readonly type: "keyboardHidden" }
  /** An animation frame, at [at]. */
  | { readonly type: "frame"; readonly at: number };

/**
 * What to do to the field: `focus` it; `refocus` it (blur, then focus: React
 * Native skips a focus on a field it already takes as focused, though Android
 * dropped it); `blur` it.
 */
export type SearchFocusCommand = "focus" | "refocus" | "blur" | null;

export interface SearchFocusStep {
  readonly state: SearchFocusState;
  readonly command: SearchFocusCommand;
  /** Whether to call again on the next animation frame (a `frame` event). */
  readonly wantsFrame: boolean;
}

export const startSearchFocus = (): SearchFocusState => ({
  shown: false,
  attached: false,
  hasFocus: false,
  keyboard: false,
  request: null,
});

/** The field has the focus and the keyboard is up: nothing left to ask. */
const raised = (state: SearchFocusState): boolean => state.hasFocus && state.keyboard;

const step = (state: SearchFocusState, command: SearchFocusCommand = null): SearchFocusStep => ({
  state,
  command,
  wantsFrame: state.request !== null,
});

/** What a frame at [at] does for a pending request. */
const onFrame = (
  state: SearchFocusState,
  at: number,
  limits: SearchFocusLimits,
): SearchFocusStep => {
  const { request } = state;
  if (request === null) return step(state);
  if (request.attempts === 0) {
    if (at - request.at > limits.waitMs) return step({ ...state, request: null });
    if (!state.shown || !state.attached) return step(state);
    // A field focused with the keyboard down (Back put it away) has to be blurred first.
    return step(
      { ...state, request: { ...request, attempts: 1, lastAt: at } },
      state.hasFocus ? "refocus" : "focus",
    );
  }
  const wait = state.hasFocus ? limits.keyboardMs : limits.retryMs;
  if (at - request.lastAt < wait) return step(state);
  if (request.attempts >= limits.attempts) return step({ ...state, request: null });
  return step(
    { ...state, request: { ...request, attempts: request.attempts + 1, lastAt: at } },
    "refocus",
  );
};

/** The next state for [event], the command it gives the field, and whether it wants a frame. */
export const stepSearchFocus = (
  state: SearchFocusState,
  event: SearchFocusEvent,
  limits: SearchFocusLimits = SEARCH_FOCUS_LIMITS,
): SearchFocusStep => {
  switch (event.type) {
    case "requested":
      if (raised(state)) return step({ ...state, request: null });
      return step({ ...state, request: { at: event.at, attempts: 0, lastAt: event.at } });
    case "shown":
      return step({ ...state, shown: true });
    case "hidden":
      return step({ ...state, shown: false, request: null }, "blur");
    case "attached":
      return step({ ...state, attached: true });
    case "focused": {
      const focused = { ...state, hasFocus: true };
      return step(raised(focused) ? { ...focused, request: null } : focused);
    }
    case "blurred":
      return step({ ...state, hasFocus: false });
    case "keyboardShown": {
      const shown = { ...state, keyboard: true };
      return step(raised(shown) ? { ...shown, request: null } : shown);
    }
    case "keyboardHidden":
      return step({ ...state, keyboard: false });
    case "frame":
      return onFrame(state, event.at, limits);
  }
};
