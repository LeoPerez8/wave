import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  contrastRatio,
  groundGradient,
  lyricsDimOpacity,
  NOW_PLAYING_FADE,
  PAGE_TOP_FADE,
  type GroundFade,
  type GroundGradient,
} from "./index.ts";

// Wave's own tokens (apps/mobile/global.css): the ground, then the text and
// control colours set on it (ink, graphite, teal).
const dark = { scheme: "dark", ground: "#000000", ink: ["#e0ecef", "#a5b0b3", "#59c0ad"] } as const;
const light = {
  scheme: "light",
  ground: "#e0ecef",
  ink: ["#121b1d", "#454f52", "#006a5f"],
} as const;

// A sunset cover, as Android Palette reports it: the mock's orange, amber and plum.
const sunset = { vibrant: "#e8573a", lightVibrant: "#f2a541", darkVibrant: "#6b2d5c" };

/** The colour [gradient] draws at [at], between the stops on either side. */
const colourAt = (gradient: GroundGradient, at: number): string => {
  const after = gradient.findIndex((stop) => stop.at >= at);
  if (after <= 0) return gradient[after === -1 ? gradient.length - 1 : 0]!.color;
  const a = gradient[after - 1]!;
  const b = gradient[after]!;
  const t = (at - a.at) / (b.at - a.at);
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(channel(a.color, i) + (channel(b.color, i) - channel(a.color, i)) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};

const legibleFrom = (gradient: GroundGradient, ink: readonly string[], from: number): boolean =>
  [from, ...gradient.filter((stop) => stop.at >= from).map((stop) => stop.at)].every((at) =>
    ink.every((colour) => contrastRatio(colour, colourAt(gradient, at)) >= 4.5),
  );

describe("groundGradient for Now Playing", () => {
  test("runs top to bottom, from the top of the screen to its foot", () => {
    for (const theme of [dark, light]) {
      const gradient = groundGradient(sunset, theme, NOW_PLAYING_FADE);
      assert.equal(gradient[0]!.at, 0);
      assert.equal(gradient.at(-1)!.at, 1);
      for (let i = 1; i < gradient.length; i++) {
        assert.ok(gradient[i]!.at >= gradient[i - 1]!.at, JSON.stringify(gradient));
      }
      // Many eased stops, so no band shows where colour meets ground.
      assert.ok(gradient.length >= 12);
    }
  });

  test("in dark mode the top is the artwork's main colour, lightly darkened", () => {
    const gradient = groundGradient(sunset, dark, NOW_PLAYING_FADE);
    // #e8573a 15% of the way to black.
    assert.equal(gradient[0]!.color, "#c54a31");
  });

  test("in light mode the top is the main colour, lightly lifted toward white", () => {
    const gradient = groundGradient(sunset, light, NOW_PLAYING_FADE);
    // #e8573a 10% of the way to white.
    assert.equal(gradient[0]!.color, "#ea684e");
  });

  test("reaches the theme's ground three quarters down and stays on it", () => {
    for (const theme of [dark, light]) {
      const gradient = groundGradient(sunset, theme, NOW_PLAYING_FADE);
      for (const stop of gradient.filter((s) => s.at >= 0.75)) {
        assert.equal(stop.color, theme.ground, JSON.stringify(gradient));
      }
      assert.notEqual(colourAt(gradient, 0.6), theme.ground);
    }
  });

  test("passes through the artwork's second colour on the way down", () => {
    // Without the second colour, the middle is the main colour fading into the ground.
    const oneColour: GroundFade = { ...NOW_PLAYING_FADE, second: null };
    const plain = groundGradient(sunset, dark, oneColour);
    const two = groundGradient(sunset, dark, NOW_PLAYING_FADE);
    const middle = 0.4;
    const plum = "#6b2d5c";
    const distance = (a: string, b: string) =>
      [0, 1, 2].reduce((sum, i) => {
        const x = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
        const y = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
        return sum + (x - y) ** 2;
      }, 0);
    assert.ok(
      distance(colourAt(two, middle), plum) < distance(colourAt(plain, middle), plum),
      `${colourAt(two, middle)} vs ${colourAt(plain, middle)}`,
    );
    // The top is still the main colour.
    assert.equal(two[0]!.color, plain[0]!.color);
  });

  test("the title and artist keep 4.5:1 from the title down, for any palette", () => {
    const palettes = [
      sunset,
      { vibrant: "#ffffff", darkVibrant: "#000000" },
      { vibrant: "#000000", lightVibrant: "#ffffff" },
      { dominant: "#7f7f7f" },
      { vibrant: "#ff0088", muted: "#528983" },
      { vibrant: "#1f5fa8", lightVibrant: "#49b6c9", darkVibrant: "#0c2340" },
      { vibrant: "#d6337a", darkVibrant: "#5b2a86", lightVibrant: "#f6c6d8" },
      { vibrant: "#8fbf6a", darkVibrant: "#2e5e3a", lightMuted: "#e8e2c8" },
      { vibrant: "#ffff00", lightVibrant: "#00ffff" },
    ];
    for (const theme of [dark, light]) {
      for (const palette of palettes) {
        const gradient = groundGradient(palette, theme, NOW_PLAYING_FADE);
        assert.ok(
          legibleFrom(gradient, theme.ink, NOW_PLAYING_FADE.legibleFrom),
          `${theme.scheme} ${JSON.stringify(palette)}: ${JSON.stringify(gradient)}`,
        );
      }
    }
  });

  test("a palette the title reads on as it is keeps its colours", () => {
    // A deep blue in dark mode: light ink reads on it everywhere already.
    const navy = { vibrant: "#1d3b5a", darkVibrant: "#101a33" };
    const guarded = groundGradient(navy, dark, NOW_PLAYING_FADE);
    const unguarded = groundGradient(navy, dark, { ...NOW_PLAYING_FADE, legibleFrom: 1 });
    assert.deepEqual(guarded, unguarded);
  });

  test("toning for the title leaves the top behind the cover as vivid as it can", () => {
    // A bright yellow can't carry light ink at the title as it is.
    const yellow = { vibrant: "#ffd400", lightVibrant: "#fff27a" };
    const gradient = groundGradient(yellow, dark, NOW_PLAYING_FADE);
    const unguarded = groundGradient(yellow, dark, { ...NOW_PLAYING_FADE, legibleFrom: 1 });
    assert.equal(gradient[0]!.color, unguarded[0]!.color);
    assert.notDeepEqual(gradient, unguarded);
  });

  test("a palette of one colour fades from that colour into the ground", () => {
    for (const theme of [dark, light]) {
      const gradient = groundGradient({ dominant: "#e74c3c" }, theme, NOW_PLAYING_FADE);
      assert.notEqual(gradient[0]!.color, theme.ground);
      assert.equal(gradient.at(-1)!.color, theme.ground);
      assert.ok(legibleFrom(gradient, theme.ink, NOW_PLAYING_FADE.legibleFrom));
    }
  });

  test("no artwork, or none of its swatches a #rrggbb colour, means the plain ground", () => {
    for (const theme of [dark, light]) {
      for (const palette of [null, {}, { vibrant: "orange" }]) {
        const gradient = groundGradient(palette, theme, NOW_PLAYING_FADE);
        assert.ok(gradient.every((stop) => stop.color === theme.ground));
        // The same stops as a coloured ground, so a crossfade between them lines up.
        assert.deepEqual(
          gradient.map((stop) => stop.at),
          groundGradient(sunset, theme, NOW_PLAYING_FADE).map((stop) => stop.at),
        );
      }
    }
  });

  test("with text everywhere, every ink keeps 4.5:1 from the top down", () => {
    const fade: GroundFade = { ...NOW_PLAYING_FADE, legibleFrom: 0 };
    for (const theme of [dark, light]) {
      for (const palette of [sunset, { vibrant: "#ffd400" }, { vibrant: "#7f7f7f" }]) {
        const gradient = groundGradient(palette, theme, fade);
        assert.ok(legibleFrom(gradient, theme.ink, 0), JSON.stringify(gradient));
        // Lyrics dim their ink on it as far as 3:1 on every stop allows.
        const stops = gradient.map((stop) => stop.color);
        const alpha = lyricsDimOpacity(stops, theme.ink[0]);
        assert.ok(alpha > 0 && alpha < 1);
      }
    }
  });
});

describe("groundGradient's other fades", () => {
  test("a short, subtle fade is a change of its options: softer and done sooner", () => {
    // The page-top gradient's look: the main colour toned a little more, mixed
    // well toward the ground, gone before half the height.
    const subtle = PAGE_TOP_FADE;
    const gradient = groundGradient(sunset, dark, subtle);
    // #e8573a 20% to black is #ba462e; 60% of the way on to black is #4a1c12.
    assert.equal(gradient[0]!.color, "#4a1c12");
    assert.ok(gradient.filter((stop) => stop.at >= 0.42).every((s) => s.color === dark.ground));
    assert.equal(gradient.length, subtle.steps + 2);
  });
});
