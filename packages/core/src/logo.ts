/**
 * Wave's logo: two rounded waves, one over the other. The single source for the
 * launcher icons and splash logos (`apps/mobile/scripts/render-icons.ts`) and
 * for the notification's small icon (`wave_notification.xml`, checked against
 * this by a test).
 */

export type LogoWave = "top" | "bottom";

/**
 * The logo in its own units, y pointing down: each wave's centre line runs
 * x = -1..1, a cosine `amplitude` high with its crest at `crestX`, shifted
 * `gap` up (top) or down (bottom) from the middle. Strokes are `stroke` wide
 * with round caps.
 */
export const LOGO_WAVES = {
  stroke: 0.2,
  amplitude: 0.18,
  period: 1.6,
  gap: 0.25,
  crestX: { top: -0.6, bottom: -0.76 },
} as const;

/** Where `wave`'s centre line is at `x` (-1..1), in the logo's units. */
export const logoWaveY = (wave: LogoWave, x: number): number => {
  const { amplitude, period, gap, crestX } = LOGO_WAVES;
  const dy = wave === "top" ? -gap : gap;
  return dy - amplitude * Math.cos((2 * Math.PI * (x - crestX[wave])) / period);
};

/** The slope of `wave`'s centre line at `x`. */
const logoWaveSlope = (wave: LogoWave, x: number): number => {
  const { amplitude, period, crestX } = LOGO_WAVES;
  const k = (2 * Math.PI) / period;
  return amplitude * k * Math.sin(k * (x - crestX[wave]));
};

export type LogoIconBox = {
  /** The icon's square side, in its units (dp for a vector drawable). */
  size: number;
  /** Empty space kept on each side. */
  inset: number;
};

export type LogoIconPaths = {
  /** SVG path data of each wave's centre line, to stroke with round caps. */
  top: string;
  bottom: string;
  stroke: number;
};

/** Cubic segments per wave: enough that the curve stays within a hundredth of the cosine. */
const SEGMENTS = 16;

/** A point in the logo's units. */
export type LogoPoint = readonly [x: number, y: number];

/** A cubic Bézier curve: start, two control points, end. */
export type LogoCubic = readonly [LogoPoint, LogoPoint, LogoPoint, LogoPoint];

/**
 * `wave`'s centre line from `from` to `to` (the cosine runs on past the
 * logo's ends) as `segments` cubic curves matching the cosine's value and
 * slope at their ends. Each curve's x moves evenly with its parameter.
 */
export const logoWaveCubics = (
  wave: LogoWave,
  from: number,
  to: number,
  segments: number,
): LogoCubic[] => {
  const step = (to - from) / segments;
  return Array.from({ length: segments }, (_, i) => {
    const x0 = from + i * step;
    const x1 = x0 + step;
    const y0 = logoWaveY(wave, x0);
    const y1 = logoWaveY(wave, x1);
    return [
      [x0, y0],
      [x0 + step / 3, y0 + (logoWaveSlope(wave, x0) * step) / 3],
      [x1 - step / 3, y1 - (logoWaveSlope(wave, x1) * step) / 3],
      [x1, y1],
    ] as const;
  });
};

const formatPathNumber = (n: number): string => String(Math.round(n * 1000) / 1000);

/** SVG path data of cubic curves, each point mapped by `point`. */
export const cubicPathData = (
  cubics: readonly LogoCubic[],
  point: (p: LogoPoint) => LogoPoint,
): string => {
  const format = (p: LogoPoint) => {
    const [x, y] = point(p);
    return `${formatPathNumber(x)} ${formatPathNumber(y)}`;
  };
  let d = `M${format(cubics[0]![0])}`;
  for (const [, c1, c2, end] of cubics) d += `C${format(c1)} ${format(c2)} ${format(end)}`;
  return d;
};

/**
 * The logo scaled into a `size` square, centred, its round caps reaching
 * `inset` from the left and right edges (it is wider than tall, so that fits
 * it). Each wave is cubic curves matching the cosine's value and slope at
 * their ends.
 */
export const logoIconPaths = ({ size, inset }: LogoIconBox): LogoIconPaths => {
  const scale = (size - 2 * inset) / (2 + LOGO_WAVES.stroke);
  const point = ([x, y]: LogoPoint): LogoPoint => [size / 2 + x * scale, size / 2 + y * scale];
  const path = (wave: LogoWave): string =>
    cubicPathData(logoWaveCubics(wave, -1, 1, SEGMENTS), point);
  return { top: path("top"), bottom: path("bottom"), stroke: LOGO_WAVES.stroke * scale };
};
