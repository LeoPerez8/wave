/**
 * The logo on the launch splash: Wave's two waves, flowing left from the
 * first frame Android draws until Wave's first screen is ready, then fading
 * out. Android draws and animates the splash itself (an animated vector the
 * config plugin builds from `launchLogoWaves`), and the native module times
 * the hand-off with `launchLogoExit` (mirrored in `launch/LaunchLogoExit.kt`).
 */

import {
  LOGO_WAVES,
  cubicPathData,
  logoWaveCubics,
  logoWaveY,
  type LogoCubic,
  type LogoWave,
} from "./logo.ts";

export const LAUNCH_LOGO = {
  /** The splash icon's side, in dp: Android shows the middle 192dp circle of it. */
  size: 288,
  /** How far from the centre the still logo's furthest edge reaches, in dp (as the shipped splash). */
  radius: 80,
  /** One sweep: each wave flows one wavelength left, back to the logo's own shape. */
  cycleMs: 1500,
  /** The splash fades out over this once Wave is ready (expo-splash-screen's default). */
  fadeMs: 400,
  /**
   * Android 12 stops a splash icon's animation after a set time (13 and later
   * play it until Wave is ready); stopped, the logo rests in its own shape.
   */
  android12MotionMs: 10_000,
} as const;

export interface LaunchLogoExit {
  /** How long the splash stays after Wave is ready, before it starts fading. */
  readonly delayMs: number;
  readonly fadeMs: number;
}

/**
 * How the splash leaves once Wave's first screen is ready: the fade starts
 * at once, wherever the sweep is. With animations removed (the logo stands
 * still) it goes as it always did.
 */
export const launchLogoExit = (): LaunchLogoExit => ({
  delayMs: 0,
  fadeMs: LAUNCH_LOGO.fadeMs,
});

/** A trim of a wave's path over one sweep, as fractions of its length. */
export interface LaunchLogoTrim {
  readonly from: number;
  readonly to: number;
  /**
   * The pace from `from` to `to` over the sweep: interpolator path data from
   * 0,0 to 1,1 (time across, progress up).
   */
  readonly curve: string;
}

/** One wave of the launch logo, in the splash icon's dp. */
export interface LaunchLogoWave {
  /** SVG path data of the centre line, running one wavelength past the logo's right end. */
  readonly path: string;
  readonly stroke: number;
  /** How far the path slides left over a sweep: one wavelength. */
  readonly slide: number;
  /**
   * What of the path shows: as it slides, the trim keeps the round caps
   * where the still logo's are, so the wave flows between them.
   */
  readonly trimStart: LaunchLogoTrim;
  readonly trimEnd: LaunchLogoTrim;
}

const WAVES: readonly LogoWave[] = ["top", "bottom"];

/** Cubic segments per logo unit of x, as fine as the logo's own. */
const SEGMENTS_PER_UNIT = 8;
/** Arc length samples per cubic. */
const SAMPLES = 64;
/** Steps of each trim's pace curve over a sweep. */
const CURVE_STEPS = 40;

/** How far the still logo's edge reaches from its centre, in logo units. */
const stillReach = (): number => {
  let max = 0;
  for (const wave of WAVES)
    for (let i = 0; i <= 400; i++) {
      const x = -1 + i / 200;
      max = Math.max(max, Math.hypot(x, logoWaveY(wave, x)));
    }
  return max + LOGO_WAVES.stroke / 2;
};

/** Arc length from the start of `cubics` up to each x, in logo units, by sampling. */
const arcLength = (cubics: readonly LogoCubic[]): ((x: number) => number) => {
  const [first] = cubics[0]!;
  const xs: number[] = [first[0]];
  const lengths: number[] = [0];
  let previous: readonly number[] = first;
  for (const [p0, p1, p2, p3] of cubics)
    for (let i = 1; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const u = 1 - t;
      const at = (k: 0 | 1) =>
        u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k];
      const point = [at(0), at(1)];
      lengths.push(
        lengths.at(-1)! + Math.hypot(point[0]! - previous[0]!, point[1]! - previous[1]!),
      );
      xs.push(point[0]!);
      previous = point;
    }
  return (x: number) => {
    const found = xs.findIndex((candidate) => candidate >= x);
    const i = found < 1 ? (found === 0 ? 1 : xs.length - 1) : found;
    const f = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
    return lengths[i - 1]! + (lengths[i]! - lengths[i - 1]!) * f;
  };
};

const fraction = (n: number): string => String(Math.round(n * 10_000) / 10_000);

/** A pace curve: `progress(t)` for t from 0 to 1, as interpolator path data. */
// not UI text: interpolator path data
const paceCurve = (progress: (t: number) => number): string => {
  let d = "M0 0";
  for (let i = 1; i < CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS;
    d += `L${fraction(t)} ${fraction(progress(t))}`;
  }
  return `${d}L1 1`;
};

/**
 * The launch logo's two waves as the splash's animated vector draws them: in
 * a `LAUNCH_LOGO.size` square, the still logo centred and reaching
 * `LAUNCH_LOGO.radius` from the centre. Each wave flows one wavelength left
 * per sweep between round caps that stay put, so every sweep starts and ends
 * on the still logo (and a stopped animation shows it, wherever it stops).
 */
export const launchLogoWaves = (): Record<LogoWave, LaunchLogoWave> => {
  const { size, radius } = LAUNCH_LOGO;
  const { period, stroke } = LOGO_WAVES;
  const scale = radius / stillReach();
  const centre = size / 2;
  const right = 1 + period;
  const segments = Math.ceil((right + 1) * SEGMENTS_PER_UNIT);
  const wave = (which: LogoWave): LaunchLogoWave => {
    const cubics = logoWaveCubics(which, -1, right, segments);
    const length = arcLength(cubics);
    const total = length(right);
    // A wavelength of the wave is as long wherever it starts, so both trims move by it.
    const sweep = length(-1 + period);
    return {
      path: cubicPathData(cubics, ([x, y]) => [centre + x * scale, centre + y * scale]),
      stroke: stroke * scale,
      slide: period * scale,
      trimStart: {
        from: 0,
        to: Number(fraction(sweep / total)),
        curve: paceCurve((t) => length(-1 + period * t) / sweep),
      },
      trimEnd: {
        from: Number(fraction(length(1) / total)),
        to: 1,
        curve: paceCurve((t) => (length(1 + period * t) - length(1)) / sweep),
      },
    };
  };
  return { top: wave("top"), bottom: wave("bottom") };
};
