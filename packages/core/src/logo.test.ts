import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { logoIconPaths, logoWaveY, type LogoWave } from "./index.ts";

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

describe("logoWaveY", () => {
  test("the top wave crests at x = -0.6, a gap plus an amplitude above the middle", () => {
    close(logoWaveY("top", -0.6), -0.43);
  });

  test("half a period later the top wave is in its trough, just above the middle", () => {
    close(logoWaveY("top", 0.2), -0.07);
  });

  test("the bottom wave crests at x = -0.76 and troughs half a period later, below the middle", () => {
    close(logoWaveY("bottom", -0.76), 0.07);
    close(logoWaveY("bottom", 0.04), 0.43);
  });
});

/** The cubic segments of an absolute `M x y C x1 y1 x2 y2 x y …` path, as point lists. */
const cubics = (d: string): number[][][] => {
  const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  assert.match(d, /^M[^A-Z]+(C[^A-Z]+)+$/, "a move then cubic curves only");
  const segments: number[][][] = [];
  let start = [numbers[0]!, numbers[1]!];
  for (let i = 2; i + 5 < numbers.length; i += 6) {
    const end = [numbers[i + 4]!, numbers[i + 5]!];
    segments.push([start, [numbers[i]!, numbers[i + 1]!], [numbers[i + 2]!, numbers[i + 3]!], end]);
    start = end;
  }
  return segments;
};

const bezier = ([p0, p1, p2, p3]: number[][], t: number, k: 0 | 1): number => {
  const u = 1 - t;
  return (
    u * u * u * p0![k]! + 3 * u * u * t * p1![k]! + 3 * u * t * t * p2![k]! + t * t * t * p3![k]!
  );
};

describe("logoIconPaths", () => {
  // A 24dp notification icon with 1dp padding: the logo is 2.2 wide with its caps, so 10dp a unit.
  const icon = logoIconPaths({ size: 24, inset: 1 });

  test("scales the logo, caps included, to the box inside the inset, centred", () => {
    assert.equal(icon.stroke, 2);
    assert.match(icon.top, /^M2 9\.5C/);
    assert.match(icon.top, /[ ,]22[ ,]7\.7$/);
    assert.match(icon.bottom, /^M2 13\.442C/);
  });

  for (const wave of ["top", "bottom"] as const satisfies LogoWave[]) {
    test(`the ${wave} wave's curve follows the logo's within a hundredth of a dp`, () => {
      const segments = cubics(icon[wave]);
      assert.ok(segments.length > 0);
      for (const segment of segments) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const x = bezier(segment, t, 0);
          const y = bezier(segment, t, 1);
          close(y, 12 + 10 * logoWaveY(wave, (x - 12) / 10), 0.01);
        }
      }
      assert.equal(segments[0]![0]![0], 2);
      assert.equal(segments.at(-1)![3]![0], 22);
    });
  }
});
