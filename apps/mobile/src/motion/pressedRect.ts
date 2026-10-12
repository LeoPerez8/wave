import type { OverlayRect } from "@wave/core";

/**
 * Where on screen the `Press` that is running its handler sits, so a menu it
 * opens can float next to it without every row passing its position along.
 * Set only while a long-press handler (or the press handler of a `Press` with
 * `opensMenu`) runs.
 */
let current: OverlayRect | undefined;

/** The window rect of the `Press` whose handler is running, if one is. */
export const pressedRect = (): OverlayRect | undefined => current;

/** Runs a press handler with `rect` as the pressed rect. */
export const runPressedAt = (rect: OverlayRect | undefined, handler: () => void): void => {
  current = rect;
  try {
    handler();
  } finally {
    current = undefined;
  }
};
