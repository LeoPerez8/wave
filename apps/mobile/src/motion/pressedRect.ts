import type { OverlayRect } from "@wave/core";

/** The `Press` whose handler is running: which one, and where it sits in the window. */
export interface PressedElement {
  /** Tells this `Press` apart from every other, for as long as it is mounted. */
  readonly key: number;
  /** Where it sits at rest; undefined when it couldn't be measured. */
  readonly rect: OverlayRect | undefined;
  /** It sits on the floating chrome (the selection bar), so the chrome never hides it. */
  readonly onChrome: boolean;
  /**
   * Corner radius of its highlight, in dp: a pill's half height for the
   * Library | Online toggle. Undefined for the usual corners, square like the row.
   */
  readonly radius: number | undefined;
}

/**
 * Where on screen the `Press` that is running its handler sits, so a card it
 * opens can float next to it, and highlight it, without every row passing its
 * position along. Set only while a long-press handler (or the press handler of
 * a `Press` with `opensMenu`) runs.
 */
let current: PressedElement | undefined;
/** Whether the running handler asked for the rect, i.e. opened a menu. */
let read = false;

/** The `Press` whose handler is running, if one is (and notes that it opened a card). */
export const pressedElement = (): PressedElement | undefined => {
  read = true;
  return current;
};

/** The window rect of the `Press` whose handler is running, if one is. */
export const pressedRect = (): OverlayRect | undefined => pressedElement()?.rect;

/**
 * Runs a press handler with `rect` as the pressed rect (of the `Press` known as
 * `key`, on the floating chrome or not, its highlight's corners rounded by
 * `radius` when given). Returns whether the handler opened a menu next to it
 * (asked for it).
 */
export const runPressedAt = (
  rect: OverlayRect | undefined,
  handler: () => void,
  {
    key = 0,
    onChrome = false,
    radius,
  }: { key?: number; onChrome?: boolean; radius?: number | undefined } = {},
): boolean => {
  current = { key, rect, onChrome, radius };
  read = false;
  try {
    handler();
    return read;
  } finally {
    current = undefined;
    read = false;
  }
};
