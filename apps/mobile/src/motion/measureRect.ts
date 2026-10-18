import { restingRect, type OverlayRect } from "@wave/core";

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

/** A view a `Press` highlights in its place, with the highlight's corner radius. */
export interface PressHighlight {
  readonly view: Measurable | null | undefined;
  /** Corner radius of the highlight and the veil's hole around it, in dp. */
  readonly radius: number;
}

/** Where a pressed element's card anchors and its highlight sits, and the highlight's corners. */
export interface PressedPlace {
  readonly rect: OverlayRect | undefined;
  /** Undefined for the usual corners, square like the row. */
  readonly radius: number | undefined;
}

/**
 * Where a press's card anchors and its highlight sits: [highlight]'s view
 * with its radius when given (the Library | Online toggle's whole pill for
 * either segment), else [press] itself at rest, grown back from the [scale]
 * its press feedback shrank it to, with the row's corners.
 */
export const measurePressed = async (
  press: Measurable | null | undefined,
  { scale, highlight }: { scale: number; highlight?: PressHighlight | undefined },
): Promise<PressedPlace> => {
  if (highlight !== undefined) {
    return { rect: await measureRect(highlight.view), radius: highlight.radius };
  }
  const rect = await measureRect(press);
  return { rect: rect && restingRect(rect, scale), radius: undefined };
};
