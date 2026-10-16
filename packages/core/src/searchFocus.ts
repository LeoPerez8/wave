/**
 * Search's field focus: tapping the Search tab raises the keyboard from that
 * one tap, on a first visit (the tap mounts the screen) and a warm one alike.
 *
 * The tap asks for the field. The field is focused on the first animation
 * frame where the screen is in sight and the field is laid out. Android can
 * drop a focus asked of a view that isn't attached to its window yet, so a
 * focus the field doesn't report is asked again, a few times at most, spaced
 * out. Leaving Search cancels whatever is pending and blurs the field, and a
 * request the screen doesn't show up for in time is dropped, so the keyboard
 * never comes up late or after Search was left.
 */

export interface SearchFocusLimits {
  /** How long a tap's request waits for the screen and its field before it is dropped. */
  readonly waitMs: number;
  /** How long a focus has to be reported before it is asked again. */
  readonly retryMs: number;
  /** How many times the field is asked to focus for one request, the first included. */
  readonly attempts: number;
}

export const SEARCH_FOCUS_LIMITS: SearchFocusLimits = {
  waitMs: 2000,
  retryMs: 150,
  attempts: 3,
};

export interface SearchFocusState {
  /** The Search screen is in sight. */
  readonly shown: boolean;
  /** The field has been laid out (it is in the window). */
  readonly attached: boolean;
  /** The field reports it has the focus. */
  readonly hasFocus: boolean;
  /** A tap's request, until the field takes the focus or the request is dropped. */
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
  /** The field reports it took the focus (natively: the keyboard is coming). */
  | { readonly type: "focused" }
  /** The field reports it lost the focus. */
  | { readonly type: "blurred" }
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
  request: null,
});

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
    return step({ ...state, request: { ...request, attempts: 1, lastAt: at } }, "focus");
  }
  if (at - request.lastAt < limits.retryMs) return step(state);
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
      if (state.hasFocus) return step({ ...state, request: null });
      return step({ ...state, request: { at: event.at, attempts: 0, lastAt: event.at } });
    case "shown":
      return step({ ...state, shown: true });
    case "hidden":
      return step({ ...state, shown: false, request: null }, "blur");
    case "attached":
      return step({ ...state, attached: true });
    case "focused":
      return step({ ...state, hasFocus: true, request: null });
    case "blurred":
      return step({ ...state, hasFocus: false });
    case "frame":
      return onFrame(state, event.at, limits);
  }
};
