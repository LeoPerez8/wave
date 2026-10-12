import type { OverlayRect } from "@wave/core";

/**
 * Where on screen the `Press` that is running its handler sits, so a menu it
 * opens can float next to it without every row passing its position along.
 * Set only while a long-press handler (or the press handler of a `Press` with
 * `opensMenu`) runs.
 */
let current: OverlayRect | undefined;
/** Whether the running handler asked for the rect, i.e. opened a menu. */
let read = false;

/** The window rect of the `Press` whose handler is running, if one is. */
export const pressedRect = (): OverlayRect | undefined => {
  read = true;
  return current;
};

/**
 * Runs a press handler with `rect` as the pressed rect. Returns whether the
 * handler opened a menu next to it (asked for `pressedRect`).
 */
export const runPressedAt = (rect: OverlayRect | undefined, handler: () => void): boolean => {
  current = rect;
  read = false;
  try {
    handler();
    return read;
  } finally {
    current = undefined;
    read = false;
  }
};
