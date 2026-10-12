import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULT_THEME, TONES, contrastRatio, themeContrastIssues } from "./index.ts";

describe("DEFAULT_THEME", () => {
  test("light mode keeps the fog theme it shipped with", () => {
    assert.deepEqual(DEFAULT_THEME.light, {
      background: "#e0ecef",
      grouped: "#d3dfe2",
      surface: "#eff4f6",
      foreground: "#121b1d",
      secondary: "#454f52",
      tertiary: "#778385",
      separator: "#c1cdd0",
      fill: "#d3dfe2",
      accent: "#006a5f",
      "on-accent": "#eff4f6",
      highlight: "#a14f09",
      destructive: "#b3261e",
    });
  });

  test("dark mode sits on a deep slate, with cards, fills and separators one step down each", () => {
    const { background, grouped, surface, fill, separator } = DEFAULT_THEME.dark;
    assert.deepEqual(
      { background, grouped, surface, fill, separator },
      {
        background: "#0a1113",
        grouped: "#0a1113",
        surface: "#121b1d",
        fill: "#121b1d",
        separator: "#1c2628",
      },
    );
  });

  test("the dark ground is a ramp step of its own, darker than light mode's text", () => {
    assert.equal(TONES.at(-1), DEFAULT_THEME.dark.background);
    assert.ok(TONES.some((tone) => tone === DEFAULT_THEME.light.foreground));
    assert.notEqual(DEFAULT_THEME.light.foreground, DEFAULT_THEME.dark.background);
  });
});

describe("themeContrastIssues", () => {
  test("the default themes meet WCAG AA: text 4.5:1 on ground, cards and groups, non-text 3:1", () => {
    assert.deepEqual(themeContrastIssues(DEFAULT_THEME.light), []);
    assert.deepEqual(themeContrastIssues(DEFAULT_THEME.dark), []);
  });

  test("dark text, accent and highlight stay comfortably readable on the deeper ground", () => {
    const dark = DEFAULT_THEME.dark;
    for (const ink of [dark.foreground, dark.secondary, dark.accent, dark.highlight]) {
      assert.ok(contrastRatio(ink, dark.background) >= 7, ink);
      assert.ok(contrastRatio(ink, dark.surface) >= 7, ink);
    }
  });

  test("names each pair that falls short, with its ratio and the minimum it needs", () => {
    const dim = { ...DEFAULT_THEME.dark, secondary: "#454f52", tertiary: "#293235" };
    assert.deepEqual(
      themeContrastIssues(dim).map(({ ink, on, minimum }) => `${ink} on ${on} < ${minimum}`),
      [
        "secondary on background < 4.5",
        "secondary on surface < 4.5",
        "secondary on grouped < 4.5",
        "tertiary on background < 3",
        "tertiary on surface < 3",
      ],
    );
    const [first] = themeContrastIssues(dim);
    assert.ok(first !== undefined && first.ratio > 1 && first.ratio < 4.5);
  });

  test("text on the accent fill needs 4.5:1 too", () => {
    const flat = { ...DEFAULT_THEME.dark, "on-accent": "#a5b0b3" };
    assert.deepEqual(
      themeContrastIssues(flat).map(({ ink, on }) => `${ink} on ${on}`),
      ["on-accent on accent"],
    );
  });
});
