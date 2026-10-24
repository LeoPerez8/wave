/// <reference types="node" />
// Android draws the launch splash from resources before Wave's code runs, so
// every splash theme Core can pick (`launchTheme`) has to ship as a style. The
// config plugin generates them; this checks what it generates resolves to
// Core's colours in each mode, and that the shipped splash draws the moving
// logo in the shipped theme's.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULT_THEME_CHOICE, LAUNCH_SPLASH_THEMES, launchTheme } from "@wave/core";

import {
  addLaunchSplashColors,
  addLaunchSplashStyles,
  type ResourcesXml,
} from "../../plugins/launchSplashResources.ts";

const SHIPPED_SPLASH = "Theme.App.SplashScreen";

/** Resources prebuild already wrote (expo-splash-screen's splash among them), which the plugin must keep. */
const existing = (): ResourcesXml => ({
  resources: {
    style: [
      { $: { name: "AppTheme", parent: "Theme.AppCompat.DayNight.NoActionBar" }, item: [] },
      {
        $: { name: SHIPPED_SPLASH, parent: "Theme.SplashScreen" },
        item: [
          { $: { name: "windowSplashScreenBackground" }, _: "@color/splashscreen_background" },
          { $: { name: "windowSplashScreenAnimatedIcon" }, _: "@drawable/splashscreen_logo" },
          { $: { name: "postSplashScreenTheme" }, _: "@style/AppTheme" },
        ],
      },
    ],
    color: [{ $: { name: "splashscreen_background" }, _: "#e0ecef" }],
  },
});

const styles = addLaunchSplashStyles(existing());
const colors = {
  light: addLaunchSplashColors(existing(), "light"),
  dark: addLaunchSplashColors(existing(), "dark"),
};

const stylesByName = new Map(styles.resources.style?.map((style) => [style.$.name, style]));
const colorsByName = {
  light: new Map(colors.light.resources.color?.map((color) => [color.$.name, color._])),
  dark: new Map(colors.dark.resources.color?.map((color) => [color.$.name, color._])),
};

const style = (name: string) => stylesByName.get(name);

/** A style's item, following its parent when it doesn't set it. */
const item = (styleName: string, itemName: string): string | undefined => {
  const found = style(styleName);
  const own = found?.item?.find((candidate) => candidate.$.name === itemName)?._;
  return own ?? (found?.$.parent ? item(found.$.parent, itemName) : undefined);
};

/** A style's colour item resolved through one mode's colour resources. */
const colour = (styleName: string, itemName: string, scheme: "light" | "dark") => {
  const name = /^@color\/(\w+)$/.exec(item(styleName, itemName) ?? "")?.[1];
  return name === undefined ? undefined : colorsByName[scheme].get(name);
};

/** The ground and the logo's colours a splash style shows in one mode. */
const shows = (styleName: string, scheme: "light" | "dark") => ({
  background: colour(styleName, "windowSplashScreenBackground", scheme),
  primary: colour(styleName, "waveLaunchPrimary", scheme),
  secondary: colour(styleName, "waveLaunchSecondary", scheme),
});

describe("launch splash styles", () => {
  test("palette styles share short colour names for identical light and dark tones", () => {
    const pairs = new Set<string>();
    for (const [name, light] of colorsByName.light) {
      if (name === "splashscreen_background") continue;
      const dark = colorsByName.dark.get(name);
      assert.ok(dark, `${name} exists in both modes`);
      const pair = `${light}/${dark}`;
      assert.equal(pairs.has(pair), false, `duplicate tones ${pair}`);
      pairs.add(pair);
      assert.ok(name.length <= 6, name);
    }
    assert.deepEqual([...colorsByName.light.keys()], [...colorsByName.dark.keys()]);
  });

  test("every splash theme Core picks shows its ground and logo colours in light and dark mode", () => {
    for (const theme of LAUNCH_SPLASH_THEMES) {
      assert.deepEqual(shows(theme.name, "light"), theme.light, `${theme.name} in light`);
      assert.deepEqual(shows(theme.name, "dark"), theme.dark, `${theme.name} in dark`);
    }
  });

  test("the shipped splash shows the shipped theme's ground and logo colours", () => {
    const shipped = launchTheme(DEFAULT_THEME_CHOICE);
    assert.deepEqual(
      { ...shows(SHIPPED_SPLASH, "light"), background: shipped.light.background },
      shipped.light,
    );
    assert.deepEqual(
      { ...shows(SHIPPED_SPLASH, "dark"), background: shipped.dark.background },
      shipped.dark,
    );
  });

  test("every splash draws the moving logo and hands over to the app theme", () => {
    for (const name of [SHIPPED_SPLASH, ...LAUNCH_SPLASH_THEMES.map((theme) => theme.name)]) {
      assert.equal(item(name, "windowSplashScreenAnimatedIcon"), "@drawable/launch_logo", name);
      assert.equal(item(name, "postSplashScreenTheme"), "@style/AppTheme", name);
    }
  });

  test("Android 12, which stops the logo after a set time, lets it move for ten seconds", () => {
    assert.equal(item(SHIPPED_SPLASH, "windowSplashScreenAnimationDuration"), "10000");
  });

  test("leaves the other resources prebuild wrote alone", () => {
    assert.deepEqual(styles.resources.style?.[0], existing().resources.style?.[0]);
    assert.deepEqual(colors.light.resources.color?.[0], existing().resources.color?.[0]);
  });

  test("running twice doesn't duplicate anything", () => {
    assert.deepEqual(addLaunchSplashStyles(addLaunchSplashStyles(existing())), styles);
    assert.deepEqual(
      addLaunchSplashColors(addLaunchSplashColors(existing(), "dark"), "dark"),
      colors.dark,
    );
  });
});
