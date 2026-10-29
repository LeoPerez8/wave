import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME_CHOICE,
  INK_PAIRS,
  LAUNCH_SPLASH_THEMES,
  THEME_SWATCHES,
  contrastRatio,
  chooseCustomInk,
  launchTheme,
  launcherIconFor,
  themeFor,
  type ThemeChoice,
} from "./index.ts";

const choose = (change: Partial<ThemeChoice>): ThemeChoice => ({
  ...DEFAULT_THEME_CHOICE,
  ...change,
});

const choiceKey = (choice: ThemeChoice): string =>
  `${choice.light}/${choice.dark}/${choice.primary}/${choice.secondary}`;

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
          ...DEFAULT_THEME_CHOICE,
          light: light.id,
          dark: dark.id,
          primary: primary.id,
          secondary: secondary.id,
        })),
      ),
    ),
  );

describe("launchTheme", () => {
  test("uses the stored icon's waves with the app's current grounds after No (#792)", () => {
    const choice = choose({ light: "sand", dark: "navy", primary: "rose", secondary: "gold" });
    const stored = launcherIconFor(DEFAULT_THEME_CHOICE);
    const launch = launchTheme(choice, stored);
    assert.deepEqual(launch.light, {
      background: "#ede6da",
      primary: "#006a5f",
      secondary: "#a14f09",
    });
    assert.deepEqual(launch.dark, {
      background: "#0a0f1f",
      primary: "#14b7a6",
      secondary: "#f5b83d",
    });
    const style = LAUNCH_SPLASH_THEMES.find((theme) => theme.name === launch.splashTheme);
    assert.deepEqual(style && { light: style.light, dark: style.dark }, {
      light: launch.light,
      dark: launch.dark,
    });
  });
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
    assert.equal(LAUNCH_SPLASH_THEMES.length, 20735);
    assert.equal(names.size, 20735);
    for (const name of names) {
      assert.match(name, /^[A-Za-z][A-Za-z0-9_.]*$/);
      assert.ok(name.length <= 10, `compact Android style name: ${name}`);
    }
  });

  test("every background pair and palette ink pair ships exactly once, except the manifest default", () => {
    const choices = new Set(LAUNCH_SPLASH_THEMES.map((theme) => choiceKey(theme.choice)));
    assert.equal(choices.size, 20735);
    for (const light of THEME_SWATCHES.light) {
      for (const dark of THEME_SWATCHES.dark) {
        for (const pair of INK_PAIRS) {
          const choice = {
            ...DEFAULT_THEME_CHOICE,
            light: light.id,
            dark: dark.id,
            primary: pair.primary.id,
            secondary: pair.secondary.id,
          };
          assert.equal(
            choices.has(choiceKey(choice)),
            choiceKey(choice) !== choiceKey(DEFAULT_THEME_CHOICE),
            choiceKey(choice),
          );
        }
      }
    }
  });

  test("a splash theme carries its preset inks corrected for the chosen backgrounds", () => {
    for (const choice of [
      choose({ light: "paper", dark: "slate", primary: "lime", secondary: "lemon" }),
      choose({ primary: "blue", secondary: "sky" }),
    ]) {
      const { light, dark } = launchTheme(choice);
      assert.deepEqual(splash(choice), { light, dark });
    }
  });

  test("a palette splash uses the icon's shipped teal and ember dark inks on other grounds", () => {
    assert.deepEqual(splash(choose({ light: "sand", dark: "navy" }))?.dark, {
      background: "#0a0f1f",
      primary: "#14b7a6",
      secondary: "#f5b83d",
    });
  });

  test("custom cyan and red use the vivid icon inks in both native splash layers", () => {
    const choice = chooseCustomInk(
      chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", "#00e9ff"),
      "secondary",
      "#ff0d00",
    );
    const name = launchTheme(choice).splashTheme;
    const selected = LAUNCH_SPLASH_THEMES.find((theme) => theme.name === name);
    assert.equal(selected?.choice.primary, "vivid209");
    assert.equal(selected?.choice.secondary, "vivid29");
    assert.deepEqual(selected?.dark, {
      background: "#000000",
      primary: "#00e5ff",
      secondary: "#ff1a1d",
    });
    assert.deepEqual(selected?.light, {
      background: "#e0ecef",
      primary: "#007380",
      secondary: "#d20003",
    });
    assert.deepEqual(launchTheme(choice).dark, selected?.dark);
    assert.deepEqual(launchTheme(choice).light, selected?.light);
  });

  test("a custom colour can still match a preset ink", () => {
    const custom = choose({ light: "sand", primary: "custom", customPrimary: "#0d2350" });
    assert.equal(
      launchTheme(custom).splashTheme,
      launchTheme({ ...custom, primary: "blue" }).splashTheme,
    );
    assert.equal(launchTheme(custom).light.primary, "#1f5fb8");
  });

  test("a kept custom colour that isn't chosen leaves the shipped splash", () => {
    assert.equal(launchTheme(choose({ customSecondary: "#ff00aa" })).splashTheme, null);
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
