import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME_CHOICE,
  LAUNCH_SPLASH_THEMES,
  THEME_SWATCHES,
  contrastRatio,
  launchTheme,
  themeFor,
  type ThemeChoice,
} from "./index.ts";

const choose = (change: Partial<ThemeChoice>): ThemeChoice => ({
  ...DEFAULT_THEME_CHOICE,
  ...change,
});

/** The colours of the splash theme a choice opens with. */
const splash = (choice: ThemeChoice) => {
  const name = launchTheme(choice).splashTheme;
  const theme = LAUNCH_SPLASH_THEMES.find((candidate) => candidate.name === name);
  return theme && { light: theme.light, dark: theme.dark };
};

/** Every choice Settings › Theme can make. */
const everyChoice = (): ThemeChoice[] =>
  THEME_SWATCHES.light.flatMap((light) =>
    THEME_SWATCHES.dark.flatMap((dark) =>
      THEME_SWATCHES.primary.flatMap((primary) =>
        THEME_SWATCHES.secondary.map((secondary) => ({
          light: light.id,
          dark: dark.id,
          primary: primary.id,
          secondary: secondary.id,
        })),
      ),
    ),
  );

describe("launchTheme", () => {
  test("the shipped theme opens on the manifest's splash", () => {
    assert.equal(launchTheme(DEFAULT_THEME_CHOICE).splashTheme, null);
  });

  test("a chosen primary or secondary opens on a splash whose logo wears it", () => {
    const choice = choose({ primary: "rose", secondary: "gold" });
    const theme = themeFor(choice);
    assert.deepEqual(splash(choice)?.light, {
      background: "#e0ecef",
      primary: theme.light.accent,
      secondary: theme.light.highlight,
    });
    assert.deepEqual(splash(choice)?.dark, {
      background: "#000000",
      primary: theme.dark.accent,
      secondary: theme.dark.highlight,
    });
  });

  test("a chosen background opens on a splash of that colour, the other mode's kept", () => {
    assert.equal(splash(choose({ light: "sand" }))?.light.background, "#ede6da");
    assert.equal(splash(choose({ light: "sand" }))?.dark.background, "#000000");
    assert.equal(splash(choose({ dark: "navy" }))?.light.background, "#e0ecef");
    assert.equal(splash(choose({ dark: "navy" }))?.dark.background, "#0a0f1f");
  });

  test("every choice Settings offers has a splash theme Android can name", () => {
    const names = new Set(LAUNCH_SPLASH_THEMES.map((theme) => theme.name));
    const choices = everyChoice();
    for (const choice of choices) {
      const name = launchTheme(choice).splashTheme;
      if (name !== null) assert.ok(names.has(name), `${JSON.stringify(choice)}: ${name}`);
    }
    assert.equal(names.size, choices.length - 1);
    for (const name of names) assert.match(name, /^[A-Za-z][A-Za-z0-9_.]*$/);
  });

  test("a splash theme carries the launch colours of the choice that names it", () => {
    for (const choice of [
      choose({ light: "paper", dark: "slate", primary: "lime", secondary: "lemon" }),
      choose({ secondary: "sky" }),
    ]) {
      const { light, dark } = launchTheme(choice);
      assert.deepEqual(splash(choice), { light, dark });
    }
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

  test("both waves read on the ground in every choice and mode (3:1, as for any graphic)", () => {
    for (const choice of everyChoice()) {
      const theme = launchTheme(choice);
      for (const scheme of ["light", "dark"] as const) {
        const { background, primary, secondary } = theme[scheme];
        for (const ink of [primary, secondary])
          assert.ok(
            contrastRatio(ink, background) >= 3,
            `${ink} on ${background} (${JSON.stringify(choice)}, ${scheme})`,
          );
      }
    }
  });
});
