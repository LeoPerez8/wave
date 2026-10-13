import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME,
  DEFAULT_THEME_CHOICE,
  NIGHT_SLATE,
  THEME_SWATCHES,
  contrastRatio,
  isDefaultThemeChoice,
  readThemeChoice,
  themeContrastIssues,
  themeFor,
  themeSwatchRows,
  type ThemeChoice,
} from "./index.ts";

const choose = (change: Partial<ThemeChoice>): ThemeChoice => ({
  ...DEFAULT_THEME_CHOICE,
  ...change,
});

/** Lighter than `b`, measured by contrast against black. */
const brighter = (a: string, b: string): boolean =>
  contrastRatio(a, "#000000") > contrastRatio(b, "#000000");

describe("themeFor", () => {
  test("the default choice is the shipped theme", () => {
    assert.deepEqual(themeFor(DEFAULT_THEME_CHOICE), DEFAULT_THEME);
  });

  test("every preset combination meets WCAG AA in both schemes", () => {
    const failures: string[] = [];
    for (const light of THEME_SWATCHES.light)
      for (const dark of THEME_SWATCHES.dark)
        for (const primary of THEME_SWATCHES.primary)
          for (const secondary of THEME_SWATCHES.secondary) {
            const choice = {
              light: light.id,
              dark: dark.id,
              primary: primary.id,
              secondary: secondary.id,
            };
            const theme = themeFor(choice);
            for (const scheme of ["light", "dark"] as const)
              for (const issue of themeContrastIssues(theme[scheme]))
                failures.push(
                  `${scheme} ${Object.values(choice).join("/")}: ${issue.ink} on ${issue.on}`,
                );
          }
    assert.deepEqual(failures, []);
  });

  test("dark mode defaults to true black", () => {
    assert.equal(DEFAULT_THEME_CHOICE.dark, "black");
    assert.equal(themeFor(DEFAULT_THEME_CHOICE).dark.background, "#000000");
  });

  test("Slate is still offered, and gives the night slate theme Wave shipped before", () => {
    assert.deepEqual(themeFor(choose({ dark: "slate" })).dark, NIGHT_SLATE);
  });

  test("the chosen background is the ground, and grouped areas share a tinted dark ground", () => {
    const theme = themeFor(choose({ light: "sand", dark: "navy" }));
    assert.equal(theme.light.background, "#ede6da");
    assert.equal(theme.dark.background, "#0a0f1f");
    assert.equal(theme.dark.grouped, "#0a0f1f");
  });

  test("on another dark ground, cards and hairlines keep Night Slate's contrast steps", () => {
    const graphite = themeFor(choose({ dark: "graphite" })).dark;
    for (const token of ["surface", "fill", "separator"] as const) {
      const expected = contrastRatio(NIGHT_SLATE[token], NIGHT_SLATE.background);
      const actual = contrastRatio(graphite[token], graphite.background);
      assert.ok(Math.abs(actual - expected) < 0.03, `${token}: ${actual} vs ${expected}`);
    }
    assert.ok(brighter(graphite.separator, graphite.surface));
  });

  test("a light ground derives cards lighter, and groups, fills and hairlines darker, than itself", () => {
    const sand = themeFor(choose({ light: "sand" })).light;
    assert.ok(brighter(sand.surface, sand.background));
    for (const token of ["grouped", "fill", "separator"] as const) {
      assert.ok(brighter(sand.background, sand[token]), token);
    }
  });

  test("a primary chosen in Settings becomes the accent of both schemes", () => {
    const theme = themeFor(choose({ primary: "blue" }));
    assert.equal(theme.light.accent, "#1f5fb8");
    assert.equal(theme.dark.accent, "#7aaef5");
  });

  test("a swatch too light for a light ground is darkened until it reads, with a readable label on it", () => {
    const light = themeFor(choose({ secondary: "lemon", primary: "lime" })).light;
    assert.notEqual(light.highlight, "#f2d22e");
    assert.ok(contrastRatio(light.highlight, light.background) >= 4.5);
    assert.ok(contrastRatio(light.highlight, light.surface) >= 4.5);
    assert.notEqual(light.accent, "#8cc63f");
    assert.ok(contrastRatio(light["on-accent"], light.accent) >= 4.5);
  });

  test("the dialog scrim follows the ground in dark mode and the text in light mode", () => {
    const theme = themeFor(choose({ light: "paper", dark: "navy" }));
    assert.equal(theme.dark.scrim, "#0a0f1f");
    assert.equal(theme.light.scrim, theme.light.foreground);
  });
});

describe("readThemeChoice", () => {
  test("a fresh install has no stored choice and gets the default theme", () => {
    assert.deepEqual(readThemeChoice(null), DEFAULT_THEME_CHOICE);
  });

  test("a dark background picked before true black became the default is kept", () => {
    const stored = JSON.stringify({
      light: "fog",
      dark: "slate",
      primary: "teal",
      secondary: "ember",
    });
    assert.equal(readThemeChoice(stored).dark, "slate");
    assert.equal(themeFor(readThemeChoice(stored)).dark.background, "#0a1113");
  });

  test("reads back a stored choice", () => {
    const stored = { light: "sage", dark: "black", primary: "violet", secondary: "gold" };
    assert.deepEqual(readThemeChoice(JSON.stringify(stored)), stored);
  });

  test("unknown swatches and unreadable JSON fall back to the default, group by group", () => {
    assert.deepEqual(
      readThemeChoice(JSON.stringify({ light: "neon", dark: "black", primary: 3 })),
      choose({ dark: "black" }),
    );
    assert.deepEqual(readThemeChoice("{not json"), DEFAULT_THEME_CHOICE);
  });
});

describe("themeSwatchRows", () => {
  test("lists light and dark backgrounds, primary and secondary, with the current choice marked", () => {
    const rows = themeSwatchRows(choose({ dark: "slate", primary: "rose" }), "dark");
    assert.deepEqual(
      rows.map((row) => [row.group, row.swatches.filter((s) => s.selected).map((s) => s.id)]),
      [
        ["light", ["fog"]],
        ["dark", ["slate"]],
        ["primary", ["rose"]],
        ["secondary", ["ember"]],
      ],
    );
  });

  test("True black leads the dark row and is marked by default; Slate still follows it", () => {
    const [, dark] = themeSwatchRows(DEFAULT_THEME_CHOICE, "dark");
    assert.deepEqual(
      dark?.swatches
        .slice(0, 2)
        .map(({ label, colour, selected }) => ({ label, colour, selected })),
      [
        { label: "True black", colour: "#000000", selected: true },
        { label: "Slate", colour: "#0a1113", selected: false },
      ],
    );
  });

  test("ink swatches show the colour they would take, readability adjustment included", () => {
    const [, , primary] = themeSwatchRows(DEFAULT_THEME_CHOICE, "light");
    const lime = primary?.swatches.find((s) => s.id === "lime");
    assert.ok(lime !== undefined && lime.colour !== "#8cc63f");
    assert.ok(contrastRatio(lime.colour, DEFAULT_THEME.light.background) >= 4.5);
    assert.equal(primary?.swatches[0]?.colour, DEFAULT_THEME.light.accent);
  });

  test("the chosen swatch's check mark is black on a pale swatch and white on a deep one", () => {
    const rows = themeSwatchRows(DEFAULT_THEME_CHOICE, "light");
    const swatch = (group: number, id: string) => rows[group]?.swatches.find((s) => s.id === id);
    assert.equal(swatch(0, "paper")?.mark, "#000000");
    assert.equal(swatch(1, "black")?.mark, "#ffffff");
    assert.equal(swatch(1, "navy")?.mark, "#ffffff");
  });
});

describe("isDefaultThemeChoice", () => {
  test("only the shipped choice is the default, so Reset is off until something changes", () => {
    assert.equal(isDefaultThemeChoice(DEFAULT_THEME_CHOICE), true);
    assert.equal(isDefaultThemeChoice(readThemeChoice(null)), true);
    assert.equal(isDefaultThemeChoice(choose({ secondary: "gold" })), false);
    assert.equal(isDefaultThemeChoice(choose({ dark: "slate" })), false);
  });
});
