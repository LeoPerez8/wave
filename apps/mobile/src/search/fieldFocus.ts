import {
  startSearchFocus,
  stepSearchFocus,
  type SearchFocusCommand,
  type SearchFocusEvent,
} from "@wave/core";
import { useFocusEffect } from "expo-router";
import { type ComponentRef, type RefObject, useCallback, useEffect, useState } from "react";
import { Keyboard, type TextInput } from "react-native";

import { perfMark } from "@/perf/perf";

import { onSearchFocusRequest, takeSearchFocusRequest } from "./focusRequest";

/** How long the Library's reads wait for the keyboard a focus is raising. */
const KEYBOARD_GRACE_MS = 400;

type Field = ComponentRef<typeof TextInput>;

/** Gives [field] what Core's `stepSearchFocus` asked of it. */
const apply = (field: Field | null, command: SearchFocusCommand): void => {
  if (command === null || field === null) return;
  if (command === "blur") {
    field.blur();
    return;
  }
  // React Native skips a focus on a field it already takes as focused, though
  // Android dropped it (asked before the field was in its window): blur first.
  if (command === "refocus" || field.isFocused()) field.blur();
  field.focus();
  perfMark("search.focus", command);
};

export interface SearchFieldFocus {
  /** For the field's `onLayout`: it is in the window. */
  readonly onLayout: () => void;
  /** For the field's focus changes, as the field reports them. */
  readonly onFocusChange: (focused: boolean) => void;
  /**
   * Whether the screen may read the Library: once it has been in sight with
   * no focus pending, and the keyboard a focus raised is up (or took too
   * long). It stays true. Until then the keyboard doesn't wait for the
   * Library's reads.
   */
  readonly libraryWanted: boolean;
}

/**
 * Drives Core's `stepSearchFocus` for one field: gives the field its
 * commands, asks for frames while a request is pending, and calls
 * [onLibraryWanted] once the Library may be read.
 */
const createFieldFocus = (field: () => Field | null, onLibraryWanted: () => void) => {
  let state = startSearchFocus();
  let frame = 0;
  let wanted = false;
  let stopWaiting: (() => void) | null = null;

  /** The Library may be read: now, or once the keyboard a focus is raising is up. */
  const settle = (): void => {
    if (wanted || stopWaiting !== null) return;
    const want = (): void => {
      stopWaiting?.();
      stopWaiting = null;
      wanted = true;
      onLibraryWanted();
    };
    if (!state.hasFocus || Keyboard.isVisible()) {
      want();
      return;
    }
    const shown = Keyboard.addListener("keyboardDidShow", want);
    const timer = setTimeout(want, KEYBOARD_GRACE_MS);
    stopWaiting = () => {
      shown.remove();
      clearTimeout(timer);
    };
  };

  function run(event: SearchFocusEvent): void {
    const step = stepSearchFocus(state, event);
    state = step.state;
    apply(field(), step.command);
    if (step.wantsFrame) {
      if (frame === 0) frame = requestAnimationFrame(onFrame);
    } else if (frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (state.shown && state.request === null) settle();
  }

  function onFrame(): void {
    frame = 0;
    run({ type: "frame", at: performance.now() });
  }

  return {
    run,
    dispose: (): void => {
      cancelAnimationFrame(frame);
      frame = 0;
      stopWaiting?.();
      stopWaiting = null;
    },
  };
};

/**
 * Raises the keyboard when the Search tab is tapped (Core's `stepSearchFocus`):
 * the field is focused on the first frame the screen is in sight and the
 * field laid out, a focus the field doesn't report is asked again a bounded
 * number of times, and leaving the screen cancels what is pending and puts
 * the keyboard away.
 */
export const useSearchFieldFocus = (field: RefObject<Field | null>): SearchFieldFocus => {
  const [libraryWanted, setLibraryWanted] = useState(false);
  const [focus] = useState(() =>
    createFieldFocus(
      () => field.current,
      () => setLibraryWanted(true),
    ),
  );

  useFocusEffect(
    useCallback(() => {
      // The request first, so the screen coming into sight doesn't let the
      // Library's reads ahead of the focus.
      const at = takeSearchFocusRequest();
      if (at !== null) focus.run({ type: "requested", at });
      focus.run({ type: "shown" });
      return () => focus.run({ type: "hidden" });
    }, [focus]),
  );

  useEffect(() => {
    const stop = onSearchFocusRequest((at) => focus.run({ type: "requested", at }));
    return () => {
      stop();
      focus.dispose();
    };
  }, [focus]);

  const onLayout = useCallback(() => focus.run({ type: "attached" }), [focus]);
  const onFocusChange = useCallback(
    (focused: boolean) => focus.run({ type: focused ? "focused" : "blurred" }),
    [focus],
  );
  return { onLayout, onFocusChange, libraryWanted };
};
