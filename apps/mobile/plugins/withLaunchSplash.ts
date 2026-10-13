// The launch splash: the moving logo (`launchLogoDrawable.ts`) on every
// splash, and a splash style for every choice Settings › Theme offers, so
// Android 13+ can open Wave on the chosen ground with the logo in the chosen
// colours (the native module picks one with `SplashScreen.setSplashScreenTheme`).
// `android/` is generated, so the resources go in through prebuild. It edits
// expo-splash-screen's splash style, so app.config.ts applies it before the
// plugin list: Expo runs the last-registered mod first.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ConfigPlugin,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
  withDangerousMod,
} from "expo/config-plugins";

import { launchLogoAttrs, launchLogoDrawable } from "./launchLogoDrawable.ts";
import {
  LAUNCH_LOGO_DRAWABLE,
  addLaunchSplashColors,
  addLaunchSplashStyles,
} from "./launchSplashResources.ts";

const writeResource = (res: string, folder: string, file: string, contents: string): void => {
  mkdirSync(join(res, folder), { recursive: true });
  writeFileSync(join(res, folder, file), contents);
};

export const withLaunchSplash: ConfigPlugin = (config) => {
  config = withDangerousMod(config, [
    "android",
    (mod) => {
      const res = join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res");
      writeResource(res, "drawable", `${LAUNCH_LOGO_DRAWABLE}.xml`, launchLogoDrawable());
      writeResource(res, "values", "launch_logo_attrs.xml", launchLogoAttrs());
      return mod;
    },
  ]);
  config = withAndroidStyles(config, (mod) => {
    mod.modResults = addLaunchSplashStyles(mod.modResults) as typeof mod.modResults;
    return mod;
  });
  config = withAndroidColors(config, (mod) => {
    mod.modResults = addLaunchSplashColors(mod.modResults, "light") as typeof mod.modResults;
    return mod;
  });
  return withAndroidColorsNight(config, (mod) => {
    mod.modResults = addLaunchSplashColors(mod.modResults, "dark") as typeof mod.modResults;
    return mod;
  });
};
