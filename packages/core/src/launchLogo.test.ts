import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LAUNCH_LOGO,
  LOGO_WAVES,
  launchLogoExit,
  launchLogoWaves,
  logoWaveY,
  type LaunchLogoTrim,
  type LogoWave,
} from "./index.ts";

const numbers = (d: string): number[] => d.match(/-?\d+(\.\d+)?/g)!.map(Number);

/** Points along an absolute `M x y C x1 y1 x2 y2 x y …` path, finely sampled. */
const pathPoints = (d: string): [number, number][] => {
  assert.match(d, /^M[^A-Z]+(C[^A-Z]+)+$/, "a move then cubic curves only");
  const n = numbers(d);
  const points: [number, number][] = [[n[0]!, n[1]!]];
  for (let i = 2; i + 5 < n.length; i += 6) {
    const [x0, y0] = points.at(-1)!;
    for (let step = 1; step <= 50; step++) {
      const t = step / 50;
      const u = 1 - t;
      const at = (a: number, b: number, c: number, e: number) =>
        u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * e;
      points.push([at(x0, n[i]!, n[i + 2]!, n[i + 4]!), at(y0, n[i + 1]!, n[i + 3]!, n[i + 5]!)]);
    }
  }
  return points;
};

/** Where along a polyline a fraction of its length falls. */
const pointAt = (points: [number, number][], fraction: number): [number, number] => {
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(
      lengths[i - 1]! +
        Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]),
    );
  const target = fraction * lengths.at(-1)!;
  const i = Math.max(
    1,
    lengths.findIndex((length) => length >= target),
  );
  const f = (target - lengths[i - 1]!) / (lengths[i]! - lengths[i - 1]! || 1);
  const [ax, ay] = points[i - 1]!;
  const [bx, by] = points[i]!;
  return [ax + (bx - ax) * f, ay + (by - ay) * f];
};

/** An interpolator curve (`M0 0L…L1 1`) at time `t`. */
const curveAt = (curve: string, t: number): number => {
  const n = numbers(curve);
  for (let i = 2; i < n.length; i += 2) {
    const [x0, y0, x1, y1] = [n[i - 2]!, n[i - 1]!, n[i]!, n[i + 1]!];
    if (t <= x1) return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0);
  }
  return 1;
};

/** A trim fraction at time `t` of a sweep. */
const trimAt = (trim: LaunchLogoTrim, t: number): number =>
  trim.from + (trim.to - trim.from) * curveAt(trim.curve, t);

const close = (actual: number, expected: number, tolerance: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message ?? ""} ${actual} is not within ${tolerance} of ${expected}`,
  );

describe("launchLogoWaves", () => {
  const waves = launchLogoWaves();
  const centre = LAUNCH_LOGO.size / 2;
  // Logo units to dp: the still logo's furthest edge reaches LAUNCH_LOGO.radius.
  const scale = waves.top.stroke / LOGO_WAVES.stroke;

  /** The two ends of a wave drawn at time `t` of a sweep, slide applied, in the icon's dp. */
  const ends = (wave: LogoWave, t: number) => {
    const points = pathPoints(waves[wave].path);
    const shift = waves[wave].slide * t;
    const at = (fraction: number) => {
      const [x, y] = pointAt(points, fraction);
      return [x - shift, y] as const;
    };
    return { start: at(trimAt(waves[wave].trimStart, t)), end: at(trimAt(waves[wave].trimEnd, t)) };
  };

  for (const wave of ["top", "bottom"] as const satisfies LogoWave[]) {
    test(`the ${wave} wave's path is the logo's wave, running a wavelength past its right end`, () => {
      const points = pathPoints(waves[wave].path);
      close(points[0]![0], centre - scale, 0.01);
      close(points.at(-1)![0], centre + scale * (1 + LOGO_WAVES.period), 0.01);
      for (const [x, y] of points)
        close(y, centre + scale * logoWaveY(wave, (x - centre) / scale), 0.05, `at x ${x}`);
    });

    test(`the ${wave} wave slides one wavelength left each sweep`, () => {
      close(waves[wave].slide, scale * LOGO_WAVES.period, 1e-9);
    });

    test(`the ${wave} wave's round caps stay where the logo's are all through a sweep`, () => {
      for (const t of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 0.9, 1]) {
        const { start, end } = ends(wave, t);
        close(start[0], centre - scale, 0.3, `left cap at t ${t}`);
        close(end[0], centre + scale, 0.3, `right cap at t ${t}`);
      }
    });

    test(`the ${wave} wave's curves pace a sweep from 0 to 1, as Android's interpolators need`, () => {
      for (const trim of [waves[wave].trimStart, waves[wave].trimEnd]) {
        const n = numbers(trim.curve);
        assert.deepEqual(n.slice(0, 2), [0, 0]);
        assert.deepEqual(n.slice(-2), [1, 1]);
        for (let i = 2; i < n.length; i += 2) {
          assert.ok(n[i]! > n[i - 2]!, "time only moves forward");
          assert.ok(n[i + 1]! >= n[i - 1]!, "the trim only moves one way");
        }
      }
    });
  }

  test("a sweep starts and ends on the still logo", () => {
    for (const wave of ["top", "bottom"] as const) {
      const { trimStart, trimEnd } = waves[wave];
      assert.equal(trimStart.from, 0);
      assert.equal(trimEnd.to, 1);
      for (const t of [0, 1]) {
        const { start, end } = ends(wave, t);
        close(start[1], centre + scale * logoWaveY(wave, -1), 0.3, `left cap at t ${t}`);
        close(end[1], centre + scale * logoWaveY(wave, 1), 0.3, `right cap at t ${t}`);
      }
    }
  });

  /** How far the logo's edge reaches from the centre at time `t` of a sweep, in dp. */
  const reach = (t: number) => {
    let max = 0;
    for (const wave of ["top", "bottom"] as const)
      for (let i = 0; i <= 200; i++) {
        const x = -1 + i / 100;
        max = Math.max(max, Math.hypot(x, logoWaveY(wave, x + LOGO_WAVES.period * t)));
      }
    return (max + LOGO_WAVES.stroke / 2) * scale;
  };

  test("the still logo reaches as far as the shipped splash's; flowing, it stays in Android's circle", () => {
    close(reach(0), LAUNCH_LOGO.radius, 0.1);
    for (let t = 0; t <= 1; t += 0.05) assert.ok(reach(t) <= 96, `${reach(t)}dp at t ${t}`);
  });
});

describe("launchLogoExit", () => {
  // The waves sweep one wavelength a second; the splash fades out over 400 ms.
  test("a quick start holds the splash so the fade ends as the first sweep does", () => {
    assert.deepEqual(launchLogoExit({ elapsedMs: 250, animationsOn: true }), {
      delayMs: 350,
      fadeMs: 400,
    });
    assert.deepEqual(launchLogoExit({ elapsedMs: 0, animationsOn: true }), {
      delayMs: 600,
      fadeMs: 400,
    });
  });

  test("once the first sweep is far enough along, the splash fades out at once", () => {
    for (const elapsedMs of [600, 1000, 2750, 12_000])
      assert.deepEqual(launchLogoExit({ elapsedMs, animationsOn: true }), {
        delayMs: 0,
        fadeMs: 400,
      });
  });

  test("with animations removed the splash goes as it always did", () => {
    assert.deepEqual(launchLogoExit({ elapsedMs: 100, animationsOn: false }), {
      delayMs: 0,
      fadeMs: 400,
    });
  });

  test("a logo that isn't moving (Android didn't animate it) isn't waited for", () => {
    assert.deepEqual(launchLogoExit({ elapsedMs: null, animationsOn: true }), {
      delayMs: 0,
      fadeMs: 400,
    });
  });

  test("a start time from the future never holds the splash past one sweep", () => {
    assert.deepEqual(launchLogoExit({ elapsedMs: -5000, animationsOn: true }), {
      delayMs: 600,
      fadeMs: 400,
    });
  });
});
