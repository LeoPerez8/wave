import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME_CHOICE,
  LAUNCH_SPLASH_THEMES,
  THEME_SWATCHES,
  launchTheme,
  themeFor,
  type ThemeChoice,
} from "./index.ts";

const choose = (change: Partial<ThemeChoice>): ThemeChoice => ({
  ...DEFAULT_THEME_CHOICE,
  ...change,
});

/** The backgrounds of the splash theme a choice opens with. */
const splash = (choice: ThemeChoice) => {
  const name = launchTheme(choice).splashTheme;
  const theme = LAUNCH_SPLASH_THEMES.find((candidate) => candidate.name === name);
  return theme && { light: theme.light, dark: theme.dark };
};

describe("launchTheme", () => {
  test("the shipped backgrounds open on the manifest's splash", () => {
    assert.equal(launchTheme(DEFAULT_THEME_CHOICE).splashTheme, null);
  });

  test("a primary or secondary alone doesn't change the splash", () => {
    assert.equal(launchTheme(choose({ primary: "rose", secondary: "gold" })).splashTheme, null);
  });

  test("a chosen background opens on a splash of that colour, the other mode's kept", () => {
    assert.deepEqual(splash(choose({ light: "sand" })), { light: "#ede6da", dark: "#000000" });
    assert.deepEqual(splash(choose({ dark: "navy" })), { light: "#e0ecef", dark: "#0a0f1f" });
    assert.deepEqual(splash(choose({ light: "paper", dark: "slate" })), {
      light: "#f5f5f3",
      dark: "#0a1113",
    });
  });

  test("every pair of backgrounds Settings offers has a splash theme Android can name", () => {
    const names = LAUNCH_SPLASH_THEMES.map((theme) => theme.name);
    for (const light of THEME_SWATCHES.light)
      for (const dark of THEME_SWATCHES.dark) {
        const name = launchTheme(choose({ light: light.id, dark: dark.id })).splashTheme;
        if (name !== null) assert.ok(names.includes(name), `${light.id}/${dark.id}: ${name}`);
      }
    assert.equal(new Set(names).size, THEME_SWATCHES.light.length * THEME_SWATCHES.dark.length - 1);
    for (const name of names) assert.match(name, /^[A-Za-z][A-Za-z0-9_.]*$/);
  });

  test("carries each mode's ground, primary and secondary as the app draws them", () => {
    const choice = choose({ light: "sage", dark: "plum", primary: "lime", secondary: "sky" });
    const theme = themeFor(choice);
    assert.deepEqual(launchTheme(choice).light, {
      background: "#e1eadc",
      primary: theme.light.accent,
      secondary: theme.light.highlight,
    });
    assert.deepEqual(launchTheme(choice).dark, {
      background: "#140c17",
      primary: theme.dark.accent,
      secondary: theme.dark.highlight,
    });
    // Lime is too pale to read on sage, so the launch screen gets the deepened tone too.
    assert.notEqual(launchTheme(choice).light.primary, "#8cc63f");
  });
});
