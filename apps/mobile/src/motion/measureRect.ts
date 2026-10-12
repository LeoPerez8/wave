import type { OverlayRect } from "@wave/core";

/** A laid-out native view (a `View`'s ref). */
export interface Measurable {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

/** Where a view sits in the app window, in dp; undefined when it isn't laid out (or has no size). */
export const measureRect = (
  node: Measurable | null | undefined,
): Promise<OverlayRect | undefined> =>
  node == null || typeof node.measureInWindow !== "function"
    ? Promise.resolve(undefined)
    : new Promise((resolve) =>
        node.measureInWindow((x, y, width, height) =>
          resolve(
            width > 0 && height > 0
              ? { left: x, top: y, right: x + width, bottom: y + height }
              : undefined,
          ),
        ),
      );
