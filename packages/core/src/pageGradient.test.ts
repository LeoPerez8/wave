import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  contrastRatio,
  groundGradient,
  PAGE_TOP_FADE,
  pageGradientPalette,
  readPageGradient,
  storedPageGradient,
} from "./index.ts";

// Wave's own tokens (apps/mobile/global.css): the ground, then ink, graphite and teal.
const dark = { scheme: "dark", ground: "#000000", ink: ["#e0ecef", "#a5b0b3", "#59c0ad"] } as const;
const light = {
  scheme: "light",
  ground: "#e0ecef",
  ink: ["#121b1d", "#454f52", "#006a5f"],
} as const;

const sunset = { vibrant: "#e8573a", lightVibrant: "#f2a541", darkVibrant: "#6b2d5c" };

const palettes = [
  sunset,
  { vibrant: "#ff0000" },
  { vibrant: "#ffff00", muted: "#808000" },
  { dominant: "#ffffff" },
  { dominant: "#111111" },
  { lightVibrant: "#9ee6ff", darkMuted: "#20323a" },
  { vibrant: "#00ff66", darkVibrant: "#004422" },
  { muted: "#7a6a8c" },
];

describe("the page-top gradient's look (Curto bem sutil)", () => {
  test("toned 20% toward black, then 60% of the way into the ground, in dark mode", () => {
    const gradient = groundGradient(sunset, dark, PAGE_TOP_FADE);
    // #e8573a 20% to black is #ba462e; 60% of the way on to black is #4a1c12.
    assert.equal(gradient[0]!.color, "#4a1c12");
    assert.equal(gradient[0]!.at, 0);
  });

  test("in light mode, toned 12% toward white, then into the ground as far as the inks need", () => {
    // #e8573a 12% to white is #eb6b52, and 60% of the way on to #e0ecef #e4b8b0.
    // Teal on Fog has little room above 4.5:1, so the guard takes it further
    // toward the ground, still warm.
    const top = groundGradient(sunset, light, PAGE_TOP_FADE)[0]!.color;
    assert.equal(top, "#e2d5d3");
    for (const ink of light.ink) assert.ok(contrastRatio(ink, top) >= 4.5);
  });

  test("reaches the plain ground 42% down and stays on it", () => {
    for (const theme of [dark, light]) {
      const gradient = groundGradient(sunset, theme, PAGE_TOP_FADE);
      assert.ok(gradient.filter((stop) => stop.at >= 0.42).every((s) => s.color === theme.ground));
      assert.equal(gradient.at(-1)!.at, 1);
    }
  });

  test("passes through no second colour", () => {
    assert.equal(PAGE_TOP_FADE.second, null);
  });

  test("keeps every ink at 4.5:1 down the whole height, in both themes", () => {
    for (const theme of [dark, light]) {
      for (const palette of palettes) {
        for (const stop of groundGradient(palette, theme, PAGE_TOP_FADE)) {
          for (const ink of theme.ink) {
            assert.ok(
              contrastRatio(ink, stop.color) >= 4.5,
              `${theme.scheme} ${JSON.stringify(palette)} ${ink} on ${stop.color}`,
            );
          }
        }
      }
    }
  });

  test("no palette gives the plain ground", () => {
    const gradient = groundGradient(null, dark, PAGE_TOP_FADE);
    assert.ok(gradient.every((stop) => stop.color === dark.ground));
  });
});

describe("the page-top gradient setting", () => {
  test("is off by default", () => {
    assert.equal(readPageGradient(null), false);
  });

  test("reads back what was stored", () => {
    assert.equal(readPageGradient(storedPageGradient(true)), true);
    assert.equal(readPageGradient(storedPageGradient(false)), false);
  });

  test("stores nothing when off, so it syncs as the default", () => {
    assert.equal(storedPageGradient(false), null);
  });

  test("anything unknown reads as off", () => {
    for (const stored of ["", "off", "true", "1", "ON"]) {
      assert.equal(readPageGradient(stored), false, stored);
    }
  });
});

describe("which colours a page takes", () => {
  const playing = { vibrant: "#123456" };
  const cover = { vibrant: "#abcdef" };

  test("a page without a cover of its own takes the playing song's", () => {
    assert.equal(pageGradientPalette(null, playing), playing);
  });

  test("nothing playing leaves such a page without colour", () => {
    assert.equal(pageGradientPalette(null, null), null);
  });

  test("an album, playlist or artist page takes its cover's", () => {
    assert.equal(pageGradientPalette({ palette: cover }, playing), cover);
  });

  test("a cover with no colours known falls back to the playing song's", () => {
    assert.equal(pageGradientPalette({ palette: null }, playing), playing);
  });

  test("while its cover's colours load, the page shows none, not the playing song's", () => {
    assert.equal(pageGradientPalette("loading", playing), null);
  });
});
