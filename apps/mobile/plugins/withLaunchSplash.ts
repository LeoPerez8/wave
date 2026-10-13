// Ships a splash style for every pair of backgrounds Settings › Theme offers,
// so Android 13+ can open Wave on the chosen ground (the native module picks
// one with `SplashScreen.setSplashScreenTheme`). `android/` is generated, so
// the resources go in through prebuild.
import {
  type ConfigPlugin,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
} from "expo/config-plugins";

import { addLaunchSplashColors, addLaunchSplashStyles } from "./launchSplashResources.ts";

export const withLaunchSplash: ConfigPlugin = (config) => {
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
