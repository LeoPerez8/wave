import { withAppBuildGradle, type ConfigPlugin } from "expo/config-plugins";

import { compileHermesWithoutSourceMap } from "./hermesFlags.ts";

/** Prebuild: compiles the JS bundle with Hermes' optimiser but no source map (#187). */
export const withHermesFlags: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = compileHermesWithoutSourceMap(mod.modResults.contents);
    return mod;
  });
