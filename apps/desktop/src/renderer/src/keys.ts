/** The window's keyboard: Core's `desktopKey` decides, these helpers read the DOM for it. */
import {
  desktopKey,
  type DesktopCommand,
  type DesktopFocus,
  type DesktopKeyPress,
} from "@wave/core";
import { useEffect, useLayoutEffect, useRef } from "react";

const FIELD =
  "input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true]";
const SLIDER = "[role=slider], input[type=range]";
/** Controls that Space presses. */
const CONTROL =
  "button, a[href], [role=button], [role=link], [role=switch], [role=checkbox], [role=menuitem], [role=tab], input[type=checkbox], input[type=radio]";
const LIST = "[role=grid], [role=listbox], [role=list], [role=tree], [role=menu]";

/** What has focus, as Core's keyboard rules name it. */
export const focusOf = (target: EventTarget | null): DesktopFocus => {
  const element = target instanceof Element ? target : null;
  if (element === null) return "other";
  if (element.closest(FIELD)) return "field";
  if (element.closest(SLIDER)) return "slider";
  if (element.closest(CONTROL)) return "control";
  if (element.closest(LIST)) return "list";
  return "other";
};

export const pressOf = (event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}): DesktopKeyPress => ({
  key: event.key,
  ctrl: event.ctrlKey || event.metaKey,
  alt: event.altKey,
  shift: event.shiftKey,
});

/** What a command does; returning false leaves the key to the browser. */
export type KeyHandlers = Partial<Record<DesktopCommand, () => boolean | void>>;

/** Runs [handlers] for the window's keys, wherever focus is. */
export function useDesktopKeys(handlers: KeyHandlers) {
  const latest = useRef(handlers);
  // Before paint: a key pressed once the window shows a change must reach the handlers that
  // saw it, or Space pauses twice instead of pausing and then playing.
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = desktopKey(pressOf(event), focusOf(event.target));
      const handler = command === undefined ? undefined : latest.current[command];
      if (handler !== undefined && handler() !== false) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
