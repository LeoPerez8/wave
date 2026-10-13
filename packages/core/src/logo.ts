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

const format = (n: number): string => String(Math.round(n * 1000) / 1000);

/**
 * The logo scaled into a `size` square, centred, its round caps reaching
 * `inset` from the left and right edges (it is wider than tall, so that fits
 * it). Each wave is cubic curves matching the cosine's value and slope at
 * their ends.
 */
export const logoIconPaths = ({ size, inset }: LogoIconBox): LogoIconPaths => {
  const scale = (size - 2 * inset) / (2 + LOGO_WAVES.stroke);
  const point = (x: number, y: number) =>
    `${format(size / 2 + x * scale)} ${format(size / 2 + y * scale)}`;
  const path = (wave: LogoWave): string => {
    const step = 2 / SEGMENTS;
    let d = `M${point(-1, logoWaveY(wave, -1))}`;
    for (let i = 0; i < SEGMENTS; i++) {
      const x0 = -1 + i * step;
      const x1 = x0 + step;
      const y0 = logoWaveY(wave, x0);
      const y1 = logoWaveY(wave, x1);
      const c1 = point(x0 + step / 3, y0 + (logoWaveSlope(wave, x0) * step) / 3);
      const c2 = point(x1 - step / 3, y1 - (logoWaveSlope(wave, x1) * step) / 3);
      d += `C${c1} ${c2} ${point(x1, y1)}`;
    }
    return d;
  };
  return { top: path("top"), bottom: path("bottom"), stroke: LOGO_WAVES.stroke * scale };
};
