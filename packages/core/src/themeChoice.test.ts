import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME,
  DEFAULT_THEME_CHOICE,
  NIGHT_SLATE,
  THEME_SWATCHES,
  contrastRatio,
  isDefaultThemeChoice,
  chooseCustomInk,
  customInkPreview,
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
            const theme = themeFor(choose(choice));
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
    const stored = {
      light: "sage",
      dark: "black",
      primary: "violet",
      secondary: "gold",
      customPrimary: "#3a7bd5",
      customSecondary: null,
    };
    assert.deepEqual(readThemeChoice(JSON.stringify(stored)), stored);
  });

  test("a choice stored before custom colours existed reads back with none", () => {
    const stored = { light: "sage", dark: "black", primary: "violet", secondary: "gold" };
    assert.deepEqual(readThemeChoice(JSON.stringify(stored)), {
      ...stored,
      customPrimary: null,
      customSecondary: null,
    });
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

  test("a kept custom colour leaves Reset on, so Reset clears it", () => {
    assert.equal(isDefaultThemeChoice(choose({ customPrimary: "#2456a8" })), false);
  });
});

describe("custom primary and secondary", () => {
  test("a stored custom colour is read back as lowercase hex and chosen", () => {
    const stored = JSON.stringify({
      ...DEFAULT_THEME_CHOICE,
      primary: "custom",
      customPrimary: "#3A7BD5",
    });
    const choice = readThemeChoice(stored);
    assert.equal(choice.primary, "custom");
    assert.equal(choice.customPrimary, "#3a7bd5");
    assert.equal(choice.customSecondary, null);
  });

  test("a custom choice without a readable colour falls back to the default preset", () => {
    for (const customSecondary of [undefined, "orange", "#12345", 42]) {
      const choice = readThemeChoice(
        JSON.stringify({ ...DEFAULT_THEME_CHOICE, secondary: "custom", customSecondary }),
      );
      assert.equal(choice.secondary, "ember", String(customSecondary));
      assert.equal(choice.customSecondary, null);
    }
  });

  test("a custom colour applies to both schemes, as it is when it reads", () => {
    const theme = themeFor(choose({ primary: "custom", customPrimary: "#2456a8" }));
    assert.equal(theme.light.accent, "#2456a8");
    // Too deep for a black ground: brightened until it reads, as a preset would be.
    assert.notEqual(theme.dark.accent, "#2456a8");
    assert.ok(brighter(theme.dark.accent, "#2456a8"));
  });

  test("a kept custom colour doesn't apply while a preset is chosen", () => {
    assert.deepEqual(
      themeFor(choose({ secondary: "gold", customSecondary: "#ff00ff" })),
      themeFor(choose({ secondary: "gold" })),
    );
  });

  test("picking a custom colour keeps it as hex and chooses it", () => {
    const choice = chooseCustomInk(choose({ primary: "rose" }), "primary", "F0A");
    assert.deepEqual(choice, choose({ primary: "custom", customPrimary: "#ff00aa" }));
    assert.equal(chooseCustomInk(choice, "primary", "not a colour"), choice);
  });

  test("the picker shows the colour that will apply in each mode", () => {
    // Pale yellow can't read on a light ground, so light mode gets a deepened tone.
    const { light, dark } = customInkPreview(
      choose({ dark: "navy" }),
      "secondary",
      "#fff3a0",
    );
    assert.deepEqual(dark, { colour: "#fff3a0", ground: "#0a0f1f", adjusted: false });
    assert.equal(light.ground, DEFAULT_THEME.light.background);
    assert.equal(light.adjusted, true);
    assert.notEqual(light.colour, "#fff3a0");
    assert.ok(contrastRatio(light.colour, DEFAULT_THEME.light.background) >= 4.5);
    assert.ok(contrastRatio(light.colour, DEFAULT_THEME.light.surface) >= 4.5);
  });

  test("Primary and Secondary end with a custom swatch, empty until a colour is picked", () => {
    const rows = themeSwatchRows(DEFAULT_THEME_CHOICE, "light");
    assert.deepEqual(
      rows.map((row) => row.custom),
      [null, null, { colour: null, selected: false, mark: null }, { colour: null, selected: false, mark: null }],
    );
  });

  test("the custom swatch shows its colour as it applies, marked while chosen", () => {
    const rows = themeSwatchRows(
      choose({ secondary: "custom", customSecondary: "#fff3a0", customPrimary: "#2456a8" }),
      "dark",
    );
    const [, , primary, secondary] = rows;
    assert.equal(secondary?.custom?.colour, "#fff3a0");
    assert.equal(secondary?.custom?.selected, true);
    assert.equal(secondary?.custom?.mark, "#000000");
    assert.deepEqual(secondary?.swatches.filter((s) => s.selected), []);
    // Kept but not chosen; brightened for the dark ground like the rest of the row.
    assert.equal(primary?.custom?.selected, false);
    assert.ok(primary?.custom?.colour && brighter(primary.custom.colour, "#2456a8"));
  });

  test("custom colours at the extremes still meet WCAG AA in both schemes", () => {
    const failures: string[] = [];
    for (const light of THEME_SWATCHES.light)
      for (const dark of THEME_SWATCHES.dark)
        for (const hex of ["#ffffff", "#000000", "#ffff00", "#0000ff", "#808080", "#ff0000"]) {
          const choice = choose({
            light: light.id,
            dark: dark.id,
            primary: "custom",
            customPrimary: hex,
            secondary: "custom",
            customSecondary: hex,
          });
          const theme = themeFor(choice);
          for (const scheme of ["light", "dark"] as const)
            for (const issue of themeContrastIssues(theme[scheme]))
              failures.push(`${scheme} ${light.id}/${dark.id} ${hex}: ${issue.ink} on ${issue.on}`);
        }
    assert.deepEqual(failures, []);
  });
});
