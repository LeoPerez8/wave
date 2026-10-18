/**
 * Framing a playlist's image (docs/spec.md, story 54): which square of the
 * picked photo becomes the image. The crop screen pans and pinches the photo
 * under a fixed square; the framing it ends on is cropped out of the original
 * photo, and kept beside it so Adjust Image opens where the owner left off.
 *
 * The crop screen runs the gesture math on the UI thread, inside Reanimated
 * worklets, so the photo follows the fingers while JavaScript is busy: those
 * functions start with the "worklet" directive (a plain string to Node and to
 * every other caller).
 */

/** A photo's size, in px. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * A square of a photo: [zoom] 1 is the largest square the photo holds, 2 a
 * square half as wide; its centre is at [centerX] × width and [centerY] ×
 * height. Any framing reads as one inside the photo (`framingSquare`).
 */
export interface ImageFraming {
  readonly zoom: number;
  readonly centerX: number;
  readonly centerY: number;
}

/** The square a framing saves, in the photo's px. */
export interface FramingSquare {
  readonly left: number;
  readonly top: number;
  readonly side: number;
}

/**
 * How the crop screen draws the photo: at [scale] (dp per photo px), its
 * top-left corner [translateX], [translateY] dp from the crop square's.
 */
export interface FramingView {
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
}

/** How far in a pinch goes: a fifth of the photo's short side. */
export const MAX_FRAMING_ZOOM = 5;

/** The photo's centre square, where the crop screen starts on a new photo. */
export const CENTRE_FRAMING: ImageFraming = { zoom: 1, centerX: 0.5, centerY: 0.5 };

const clamp = (value: number, low: number, high: number): number => {
  "worklet";
  return Math.max(low, Math.min(high, value));
};

/** [framing] with its zoom within limits and its square inside the photo. */
const clampFraming = (size: ImageSize, framing: ImageFraming): ImageFraming => {
  "worklet";
  const zoom = clamp(framing.zoom, 1, MAX_FRAMING_ZOOM);
  const half = Math.min(size.width, size.height) / zoom / 2;
  const centreX = clamp(framing.centerX * size.width, half, size.width - half);
  const centreY = clamp(framing.centerY * size.height, half, size.height - half);
  return { zoom, centerX: centreX / size.width, centerY: centreY / size.height };
};

/** The square of the photo [framing] saves, in whole px. */
export const framingSquare = (size: ImageSize, framing: ImageFraming): FramingSquare => {
  const { zoom, centerX, centerY } = clampFraming(size, framing);
  const side = Math.round(Math.min(size.width, size.height) / zoom);
  return {
    left: clamp(Math.floor(centerX * size.width - side / 2 + 1e-9), 0, size.width - side),
    top: clamp(Math.floor(centerY * size.height - side / 2 + 1e-9), 0, size.height - side),
    side,
  };
};

/** How the crop screen draws the photo under a crop square [viewport] dp wide. */
export const framingView = (
  size: ImageSize,
  viewport: number,
  framing: ImageFraming,
): FramingView => {
  "worklet";
  const { zoom, centerX, centerY } = clampFraming(size, framing);
  const scale = (viewport * zoom) / Math.min(size.width, size.height);
  return {
    scale,
    translateX: viewport / 2 - centerX * size.width * scale,
    translateY: viewport / 2 - centerY * size.height * scale,
  };
};

/** [framing] after the photo is dragged [dx], [dy] dp: it follows the finger, up to its edges. */
export const panFraming = (
  size: ImageSize,
  viewport: number,
  framing: ImageFraming,
  dx: number,
  dy: number,
): ImageFraming => {
  "worklet";
  const { scale } = framingView(size, viewport, framing);
  const current = clampFraming(size, framing);
  return clampFraming(size, {
    zoom: current.zoom,
    centerX: current.centerX - dx / scale / size.width,
    centerY: current.centerY - dy / scale / size.height,
  });
};

/**
 * [framing] after a pinch grows the photo by [factor] around the point
 * [focalX], [focalY] dp from the crop square's top-left corner, which keeps
 * showing the same spot of the photo (as far as the edges and limits allow).
 */
export const pinchFraming = (
  size: ImageSize,
  viewport: number,
  framing: ImageFraming,
  factor: number,
  focalX: number,
  focalY: number,
): ImageFraming => {
  "worklet";
  const before = framingView(size, viewport, framing);
  const pointX = (focalX - before.translateX) / before.scale;
  const pointY = (focalY - before.translateY) / before.scale;
  const zoom = clamp(clampFraming(size, framing).zoom * factor, 1, MAX_FRAMING_ZOOM);
  const scale = (viewport * zoom) / Math.min(size.width, size.height);
  return clampFraming(size, {
    zoom,
    centerX: (viewport / 2 - (focalX - pointX * scale)) / scale / size.width,
    centerY: (viewport / 2 - (focalY - pointY * scale)) / scale / size.height,
  });
};

/** [framing] of a photo of [size], as kept beside the original. */
export const framingText = (size: ImageSize, framing: ImageFraming): string =>
  JSON.stringify({
    width: size.width,
    height: size.height,
    zoom: framing.zoom,
    centerX: framing.centerX,
    centerY: framing.centerY,
  });

const isPositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isFraction = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** What `framingText` kept; null for anything else. */
export const readFraming = (
  text: string | null,
): { readonly size: ImageSize; readonly framing: ImageFraming } | null => {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { width, height, zoom, centerX, centerY } = value as Record<string, unknown>;
  if (!isPositive(width) || !isPositive(height) || !isPositive(zoom)) return null;
  if (!isFraction(centerX) || !isFraction(centerY)) return null;
  return { size: { width, height }, framing: { zoom, centerX, centerY } };
};
