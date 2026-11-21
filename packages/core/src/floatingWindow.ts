/** Where a small always-on-top window (the desktop's mini player) opens. */

export interface WindowPosition {
  readonly x: number;
  readonly y: number;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

/** A screen's usable area, in the desktop's coordinates. */
export interface ScreenArea extends WindowPosition, WindowSize {}

/** The gap a window never placed keeps from its screen's corner. */
const CORNER_MARGIN = 24;

const overlap = (position: WindowPosition, size: WindowSize, area: ScreenArea): number =>
  Math.max(
    0,
    Math.min(position.x + size.width, area.x + area.width) - Math.max(position.x, area.x),
  ) *
  Math.max(
    0,
    Math.min(position.y + size.height, area.y + area.height) - Math.max(position.y, area.y),
  );

/** [value] moved into a screen's span, from its start when the window is longer than it. */
const within = (value: number, length: number, start: number, span: number): number =>
  Math.max(start, Math.min(value, start + span - length));

/**
 * Where the window opens: where it was left while the screens show all of it, else moved whole
 * onto the screen showing most of it, or onto the first screen when its own is gone. A window
 * never placed opens in the first screen's bottom right corner.
 */
export const floatingWindowPosition = (
  saved: WindowPosition | undefined,
  size: WindowSize,
  areas: readonly ScreenArea[],
): WindowPosition => {
  const first = areas[0];
  if (first === undefined) return saved ?? { x: 0, y: 0 };
  if (saved === undefined)
    return {
      x: within(
        first.x + first.width - size.width - CORNER_MARGIN,
        size.width,
        first.x,
        first.width,
      ),
      y: within(
        first.y + first.height - size.height - CORNER_MARGIN,
        size.height,
        first.y,
        first.height,
      ),
    };
  let shown = 0;
  let best = first;
  let most = 0;
  for (const area of areas) {
    const part = overlap(saved, size, area);
    shown += part;
    if (part > most) {
      most = part;
      best = area;
    }
  }
  if (shown >= size.width * size.height) return saved;
  return {
    x: within(saved.x, size.width, best.x, best.width),
    y: within(saved.y, size.height, best.y, best.height),
  };
};

export const storedFloatingWindowPosition = (position: WindowPosition): string =>
  JSON.stringify({ x: position.x, y: position.y });

/** The position [stored] holds, or nothing for a window never placed or a value that isn't one. */
export const readFloatingWindowPosition = (
  stored: string | null | undefined,
): WindowPosition | undefined => {
  if (!stored) return undefined;
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const { x, y } = value as { readonly x?: unknown; readonly y?: unknown };
    return Number.isSafeInteger(x) && Number.isSafeInteger(y)
      ? { x: x as number, y: y as number }
      : undefined;
  } catch {
    return undefined;
  }
};
