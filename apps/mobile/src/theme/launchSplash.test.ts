/// <reference types="node" />
// Android draws the launch splash from resources before Wave's code runs, so
// every splash theme Core can pick (`launchTheme`) has to ship as a style. The
// config plugin generates them; this checks what it generates resolves to
// Core's grounds in each mode.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LAUNCH_SPLASH_THEMES } from "@wave/core";

import {
  addLaunchSplashColors,
  addLaunchSplashStyles,
  type ResourcesXml,
} from "../../plugins/launchSplashResources.ts";

/** Resources prebuild already wrote, which the plugin must keep. */
const existing = (): ResourcesXml => ({
  resources: {
    style: [{ $: { name: "AppTheme", parent: "Theme.AppCompat.DayNight.NoActionBar" }, item: [] }],
    color: [{ $: { name: "splashscreen_background" }, _: "#e0ecef" }],
  },
});

const styles = addLaunchSplashStyles(existing());
const lightColors = addLaunchSplashColors(existing(), "light");
const darkColors = addLaunchSplashColors(existing(), "dark");

/** The ground a style's splash shows, resolved through the colour resources of one mode. */
const ground = (styleName: string, colors: ResourcesXml): string | undefined => {
  const style = styles.resources.style?.find((candidate) => candidate.$.name === styleName);
  const value = style?.item?.find((item) => item.$.name === "windowSplashScreenBackground")?._;
  const colorName = /^@color\/(\w+)$/.exec(value ?? "")?.[1];
  return colors.resources.color?.find((color) => color.$.name === colorName)?._;
};

describe("launch splash styles", () => {
  test("every splash theme Core picks shows its grounds in light and dark mode", () => {
    for (const theme of LAUNCH_SPLASH_THEMES) {
      assert.equal(ground(theme.name, lightColors), theme.light, `${theme.name} in light`);
      assert.equal(ground(theme.name, darkColors), theme.dark, `${theme.name} in dark`);
    }
  });

  test("each keeps the shipped splash's logo and hands over to the app theme", () => {
    for (const theme of LAUNCH_SPLASH_THEMES) {
      const style = styles.resources.style?.find((candidate) => candidate.$.name === theme.name);
      assert.equal(style?.$.parent, "Theme.App.SplashScreen", theme.name);
    }
  });

  test("leaves the resources prebuild wrote alone", () => {
    assert.deepEqual(styles.resources.style?.[0], existing().resources.style?.[0]);
    assert.deepEqual(lightColors.resources.color?.[0], existing().resources.color?.[0]);
  });

  test("running twice doesn't duplicate anything", () => {
    assert.deepEqual(addLaunchSplashStyles(addLaunchSplashStyles(existing())), styles);
    assert.deepEqual(
      addLaunchSplashColors(addLaunchSplashColors(existing(), "dark"), "dark"),
      darkColors,
    );
  });
});
