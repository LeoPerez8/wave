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
  inkSaveState,
  pulledThemeChoice,
  readThemeChoice,
  removeSavedInk,
  resetThemeChoice,
  sameThemeChoice,
  saveInk,
  storedThemeOnStart,
  themeContrastIssues,
  themeFor,
  themeSwatchRows,
  type ThemeChoice,
} from "./index.ts";

const choose = (change: Partial<ThemeChoice>): ThemeChoice => ({
  ...DEFAULT_THEME_CHOICE,
  ...change,
});

/** The saved primaries Wave reads from `savedPrimary` as stored. */
const read = (savedPrimary: unknown) =>
  readThemeChoice(JSON.stringify({ ...DEFAULT_THEME_CHOICE, savedPrimary })).savedPrimary;

/** A choice as Wave stored it before saved colours, read as Wave reads it now. */
const former = (stored: Record<string, string>): ThemeChoice =>
  readThemeChoice(JSON.stringify({ ...DEFAULT_THEME_CHOICE, ...stored }));

const FORMER_PRIMARIES = ["teal", "blue", "violet", "green", "rose", "lime"];
const FORMER_SECONDARIES = ["ember", "gold", "coral", "magenta", "sky", "lemon"];

/** Lighter than `b`, measured by contrast against black. */
const brighter = (a: string, b: string): boolean =>
  contrastRatio(a, "#000000") > contrastRatio(b, "#000000");

describe("themeFor", () => {
  test("the default choice is the shipped neutrals with white inks: white in dark, the text colour in light (#793)", () => {
    const theme = themeFor(DEFAULT_THEME_CHOICE);
    assert.deepEqual(theme.dark, {
      ...DEFAULT_THEME.dark,
      accent: "#ffffff",
      highlight: "#ffffff",
    });
    assert.deepEqual(theme.light, {
      ...DEFAULT_THEME.light,
      accent: "#121b1d",
      highlight: "#121b1d",
    });
  });

  test("Teal and Ember, stored before saved colours, still give the theme Wave shipped before", () => {
    assert.deepEqual(themeFor(former({ primary: "teal", secondary: "ember" })), DEFAULT_THEME);
  });

  test("the default inks take each light ground's own text colour and stay white on every dark ground", () => {
    for (const light of THEME_SWATCHES.light)
      for (const dark of THEME_SWATCHES.dark) {
        const theme = themeFor(choose({ light: light.id, dark: dark.id }));
        assert.equal(theme.light.accent, theme.light.foreground, light.id);
        assert.equal(theme.light.highlight, theme.light.foreground, light.id);
        assert.equal(theme.dark.accent, "#ffffff", dark.id);
        assert.equal(theme.dark.highlight, "#ffffff", dark.id);
      }
  });

  test("every background with Default or a former preset meets WCAG AA in both schemes", () => {
    const failures: string[] = [];
    for (const light of THEME_SWATCHES.light)
      for (const dark of THEME_SWATCHES.dark)
        for (const primary of ["white", ...FORMER_PRIMARIES])
          for (const secondary of ["white", ...FORMER_SECONDARIES]) {
            const choice = { light: light.id, dark: dark.id, primary, secondary };
            const theme = themeFor(former(choice));
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
    assert.deepEqual(
      themeFor(former({ dark: "slate", primary: "teal", secondary: "ember" })).dark,
      NIGHT_SLATE,
    );
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

  test("a former preset keeps both of its tones as a custom colour", () => {
    const theme = themeFor(former({ primary: "blue", secondary: "coral" }));
    assert.equal(theme.light.accent, "#1f5fb8");
    assert.equal(theme.dark.accent, "#7aaef5");
    assert.equal(theme.light.highlight, "#b2402c");
    assert.equal(theme.dark.highlight, "#f5917e");
  });

  test("a swatch too light for a light ground is darkened until it reads, with a readable label on it", () => {
    const light = themeFor(former({ secondary: "lemon", primary: "lime" })).light;
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
      primary: "custom",
      secondary: "white",
      customPrimary: "#3a7bd5",
      customSecondary: null,
      savedPrimary: ["#3a7bd5", "#a99af0"],
      savedSecondary: ["#e8c454"],
    };
    assert.deepEqual(readThemeChoice(JSON.stringify(stored)), stored);
  });

  test("a choice stored before custom colours existed reads back with its presets saved", () => {
    const stored = { light: "sage", dark: "black", primary: "violet", secondary: "white" };
    assert.deepEqual(readThemeChoice(JSON.stringify(stored)), {
      ...stored,
      primary: "custom",
      customPrimary: "#a99af0",
      customSecondary: null,
      savedPrimary: ["#a99af0"],
      savedSecondary: [],
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

describe("storedThemeOnStart", () => {
  const ranBefore = { storedTheme: null, storedIcon: null, launchThemeSaved: true };

  test("an install that ran an older Wave with nothing stored keeps teal over ember (#793)", () => {
    const stored = storedThemeOnStart(ranBefore);
    assert.notEqual(stored, null);
    assert.deepEqual(readThemeChoice(stored), {
      light: "fog",
      dark: "black",
      primary: "custom",
      secondary: "custom",
      customPrimary: "#59c0ad",
      customSecondary: "#ec9d53",
      savedPrimary: ["#59c0ad"],
      savedSecondary: ["#ec9d53"],
    });
    // Stored in the shape this Wave writes, so nothing is left to migrate.
    assert.deepEqual(JSON.parse(stored ?? ""), readThemeChoice(stored));
  });

  test("a fresh install stores nothing and starts on the white default", () => {
    assert.equal(storedThemeOnStart({ ...ranBefore, launchThemeSaved: false }), null);
  });

  test("a stored theme is kept as it is", () => {
    const storedTheme = JSON.stringify(choose({ primary: "custom", customPrimary: "#f08cb0" }));
    assert.equal(storedThemeOnStart({ ...ranBefore, storedTheme }), null);
  });

  test("once this Wave has stored its icon, nothing stored means the white default", () => {
    assert.equal(storedThemeOnStart({ ...ranBefore, storedIcon: "white_white" }), null);
  });
});

describe("themeSwatchRows", () => {
  test("lists light and dark backgrounds, primary and secondary, with the current choice marked", () => {
    const rows = themeSwatchRows(choose({ dark: "slate", light: "sand" }), "dark");
    assert.deepEqual(
      rows.map((row) => [row.group, row.swatches.filter((s) => s.selected).map((s) => s.id)]),
      [
        ["light", ["sand"]],
        ["dark", ["slate"]],
        ["primary", ["white"]],
        ["secondary", ["white"]],
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

  test("Primary and Secondary start with a Default swatch: white in dark mode, the text colour in light (#793)", () => {
    for (const [scheme, colour, mark] of [
      ["dark", "#ffffff", "#000000"],
      ["light", "#121b1d", "#ffffff"],
    ] as const) {
      const [, , primary, secondary] = themeSwatchRows(DEFAULT_THEME_CHOICE, scheme);
      for (const row of [primary, secondary])
        assert.deepEqual(row?.swatches[0], {
          id: "white",
          label: "Default",
          colour,
          selected: true,
          mark,
        });
    }
    const [, , primary, secondary] = themeSwatchRows(
      choose({ primary: "custom", customPrimary: "#59c0ad" }),
      "dark",
    );
    assert.equal(primary?.swatches[0]?.selected, false);
    assert.equal(secondary?.swatches[0]?.selected, true);
  });

  test("Primary and Secondary offer Default and no presets (#794)", () => {
    const [, , primary, secondary] = themeSwatchRows(DEFAULT_THEME_CHOICE, "light");
    assert.deepEqual(
      primary?.swatches.map((s) => s.label),
      ["Default"],
    );
    assert.deepEqual(
      secondary?.swatches.map((s) => s.label),
      ["Default"],
    );
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
    assert.equal(
      isDefaultThemeChoice(choose({ secondary: "custom", customSecondary: "#e8c454" })),
      false,
    );
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

  test("a custom choice without a readable colour falls back to Default", () => {
    for (const customSecondary of [undefined, "orange", "#12345", 42]) {
      const choice = readThemeChoice(
        JSON.stringify({ ...DEFAULT_THEME_CHOICE, secondary: "custom", customSecondary }),
      );
      assert.equal(choice.secondary, "white", String(customSecondary));
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

  test("a kept custom colour doesn't apply while Default is chosen", () => {
    assert.deepEqual(
      themeFor(choose({ customSecondary: "#ff00ff" })),
      themeFor(DEFAULT_THEME_CHOICE),
    );
  });

  test("picking a custom or saved colour keeps it as hex and chooses it, the saved ones kept", () => {
    const choice = chooseCustomInk(choose({ savedPrimary: ["#f08cb0"] }), "primary", "F0A");
    assert.deepEqual(
      choice,
      choose({ primary: "custom", customPrimary: "#ff00aa", savedPrimary: ["#f08cb0"] }),
    );
    assert.equal(chooseCustomInk(choice, "primary", "not a colour"), choice);
  });

  test("the picker shows the colour that will apply in each mode", () => {
    // Pale yellow can't read on a light ground, so light mode gets a deepened tone.
    const { light, dark } = customInkPreview(choose({ dark: "navy" }), "secondary", "#fff3a0");
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
      [
        null,
        null,
        ...[1, 2].map(() => ({ picked: null, colour: null, selected: false, mark: null })),
      ],
    );
  });

  test("the custom swatch shows its colour as it applies, marked while chosen", () => {
    const rows = themeSwatchRows(
      choose({ secondary: "custom", customSecondary: "#fff3a0", customPrimary: "#2456a8" }),
      "dark",
    );
    const [, , primary, secondary] = rows;
    assert.equal(secondary?.custom?.colour, "#fff3a0");
    assert.equal(primary?.custom?.picked, "#2456a8");
    assert.equal(secondary?.custom?.selected, true);
    assert.equal(secondary?.custom?.mark, "#000000");
    assert.deepEqual(
      secondary?.swatches.filter((s) => s.selected),
      [],
    );
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

describe("saved colours (#794)", () => {
  test("a preset stored before saved colours becomes the custom colour and the group's first saved one", () => {
    const stored = { light: "sand", dark: "slate", primary: "teal", secondary: "gold" };
    assert.deepEqual(readThemeChoice(JSON.stringify(stored)), {
      light: "sand",
      dark: "slate",
      primary: "custom",
      secondary: "custom",
      customPrimary: "#59c0ad",
      customSecondary: "#e8c454",
      savedPrimary: ["#59c0ad"],
      savedSecondary: ["#e8c454"],
    });
  });

  test("a colour kept beside a former preset is saved after it, so it can be picked again", () => {
    const choice = former({
      primary: "rose",
      customPrimary: "#2456A8",
      customSecondary: "#ffeeaa",
    });
    assert.equal(choice.primary, "custom");
    assert.equal(choice.customPrimary, "#f08cb0");
    assert.deepEqual(choice.savedPrimary, ["#f08cb0", "#2456a8"]);
    // Default secondary: its kept colour stays kept, nothing is saved.
    assert.equal(choice.secondary, "white");
    assert.equal(choice.customSecondary, "#ffeeaa");
    assert.deepEqual(choice.savedSecondary, []);
  });

  test("saved colours that aren't colours, repeats and any past four are dropped", () => {
    for (const bad of [null, "#ff0000", 7, { 0: "#ff0000" }]) assert.deepEqual(read(bad), []);
    assert.deepEqual(read(["#FF0000", "red", 3, null, "#f00", "#00ff00"]), ["#ff0000", "#00ff00"]);
    assert.deepEqual(read(["#000001", "#000002", "#000003", "#000004", "#000005"]), [
      "#000001",
      "#000002",
      "#000003",
      "#000004",
    ]);
  });

  test("Primary and Secondary show Default, the saved colours as they apply, then Custom", () => {
    const choice = choose({
      primary: "custom",
      customPrimary: "#8cc63f",
      savedPrimary: ["#2456a8", "#8cc63f"],
      savedSecondary: ["#fff3a0"],
    });
    const [light, dark, primary, secondary] = themeSwatchRows(choice, "light");
    assert.deepEqual(light?.saved, []);
    assert.deepEqual(dark?.saved, []);
    // Lime is too pale for the light ground, so its swatch shows the deepened tone.
    const lime = customInkPreview(choice, "primary", "#8cc63f").light.colour;
    assert.notEqual(lime, "#8cc63f");
    assert.deepEqual(primary?.saved, [
      { hex: "#2456a8", colour: "#2456a8", selected: false, mark: "#ffffff" },
      { hex: "#8cc63f", colour: lime, selected: true, mark: "#ffffff" },
    ]);
    assert.equal(primary?.swatches[0]?.selected, false);
    // Its colour is a saved one, which is marked: the custom swatch shows the hue wheel.
    assert.deepEqual(primary?.custom, {
      picked: "#8cc63f",
      colour: null,
      selected: false,
      mark: null,
    });
    assert.equal(secondary?.saved[0]?.selected, false);
    assert.equal(secondary?.swatches[0]?.selected, true);
  });

  test("a custom colour that isn't saved is marked on the custom swatch", () => {
    const choice = choose({
      secondary: "custom",
      customSecondary: "#ff00aa",
      savedSecondary: ["#e8c454"],
    });
    const [, , , secondary] = themeSwatchRows(choice, "dark");
    assert.equal(secondary?.custom?.selected, true);
    assert.equal(secondary?.custom?.colour, "#ff00aa");
    assert.deepEqual(
      secondary?.saved.map((s) => s.selected),
      [false],
    );
  });

  test("Save adds the picker's colour to its group's saved colours without applying it", () => {
    const choice = saveInk(DEFAULT_THEME_CHOICE, "primary", "#3A7BD5");
    assert.deepEqual(choice, choose({ savedPrimary: ["#3a7bd5"] }));
    assert.deepEqual(themeFor(choice), themeFor(DEFAULT_THEME_CHOICE));
    assert.deepEqual(saveInk(choice, "primary", "#a99af0").savedPrimary, ["#3a7bd5", "#a99af0"]);
    assert.deepEqual(saveInk(choice, "secondary", "#a99af0").savedSecondary, ["#a99af0"]);
  });

  test("Save takes up to four colours, each once", () => {
    const four = choose({ savedSecondary: ["#000001", "#000002", "#000003", "#000004"] });
    assert.equal(inkSaveState(four, "secondary", "#ff0000"), "full");
    assert.equal(saveInk(four, "secondary", "#ff0000"), four);
    assert.equal(inkSaveState(four, "primary", "#ff0000"), "ready");
    const one = choose({ savedPrimary: ["#3a7bd5"] });
    assert.equal(inkSaveState(one, "primary", "#3A7BD5"), "saved");
    assert.equal(saveInk(one, "primary", "#3A7BD5"), one);
    assert.equal(inkSaveState(one, "primary", "not a colour"), "invalid");
    assert.equal(saveInk(one, "primary", "not a colour"), one);
    // A colour already saved says so, even in a full row.
    assert.equal(inkSaveState(four, "secondary", "#000002"), "saved");
  });

  test("Remove takes a saved colour out and leaves the colours in use as they are", () => {
    const choice = choose({
      primary: "custom",
      customPrimary: "#a99af0",
      savedPrimary: ["#3a7bd5", "#a99af0", "#59c0ad"],
    });
    const removed = removeSavedInk(choice, "primary", "#A99AF0");
    assert.deepEqual(removed.savedPrimary, ["#3a7bd5", "#59c0ad"]);
    assert.deepEqual(themeFor(removed), themeFor(choice));
    // The colour still applies, now from the custom swatch.
    const [, , primary] = themeSwatchRows(removed, "dark");
    assert.equal(primary?.custom?.selected, true);
    assert.equal(primary?.custom?.colour, "#a99af0");
    assert.equal(removeSavedInk(removed, "primary", "#ffffff"), removed);
  });

  test("Reset to defaults keeps the saved colours, which leave nothing to reset", () => {
    const choice = choose({
      dark: "plum",
      primary: "custom",
      customPrimary: "#a99af0",
      savedPrimary: ["#a99af0"],
      savedSecondary: ["#e8c454", "#ff00aa"],
    });
    const reset = resetThemeChoice(choice);
    assert.deepEqual(
      reset,
      choose({ savedPrimary: ["#a99af0"], savedSecondary: ["#e8c454", "#ff00aa"] }),
    );
    assert.equal(isDefaultThemeChoice(reset), true);
    assert.equal(isDefaultThemeChoice(choice), false);
  });

  test("two choices are the same when every group and saved colour is, in order", () => {
    const choice = choose({ savedPrimary: ["#3a7bd5", "#a99af0"] });
    assert.equal(sameThemeChoice(choice, readThemeChoice(JSON.stringify(choice))), true);
    assert.equal(sameThemeChoice(choice, choose({ savedPrimary: ["#a99af0", "#3a7bd5"] })), false);
    assert.equal(sameThemeChoice(choice, { ...choice, savedSecondary: ["#3a7bd5"] }), false);
    assert.equal(sameThemeChoice(choice, { ...choice, dark: "navy" }), false);
  });
});

describe("pulledThemeChoice", () => {
  const four = ["#000001", "#000002", "#000003", "#000004"];
  const local = choose({ savedPrimary: four, savedSecondary: ["#ff00aa"] });

  test("a theme from a Wave before saved colours keeps this phone's saved colours", () => {
    // That phone picked the Blue preset and kept a custom secondary.
    const pulled = JSON.stringify({
      light: "fog",
      dark: "navy",
      primary: "blue",
      secondary: "custom",
      customPrimary: null,
      customSecondary: "#123456",
    });
    const choice = pulledThemeChoice(pulled, local);
    assert.equal(choice.dark, "navy");
    assert.equal(choice.customPrimary, "#7aaef5");
    assert.equal(choice.customSecondary, "#123456");
    // The former preset's colour goes first, as on this phone's own update.
    assert.deepEqual(choice.savedPrimary, ["#7aaef5", "#000001", "#000002", "#000003"]);
    assert.deepEqual(choice.savedSecondary, ["#ff00aa"]);
    assert.deepEqual(pulledThemeChoice(null, local).savedPrimary, four);
  });

  test("a theme with saved colours takes them as they are, even none", () => {
    const pulled = JSON.stringify(choose({ savedPrimary: [], savedSecondary: ["#00aa55"] }));
    assert.deepEqual(pulledThemeChoice(pulled, local), readThemeChoice(pulled));
    const one = JSON.stringify({
      ...choose({}),
      savedPrimary: ["#00aa55"],
      savedSecondary: undefined,
    });
    assert.deepEqual(pulledThemeChoice(one, local).savedSecondary, ["#ff00aa"]);
    assert.deepEqual(pulledThemeChoice(one, local).savedPrimary, ["#00aa55"]);
  });
});
