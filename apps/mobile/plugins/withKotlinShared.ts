import { withSettingsGradle, type ConfigPlugin } from "expo/config-plugins";

import { includeKotlinShared } from "./kotlinShared.ts";

/** Prebuild: includes packages/kotlin-shared in the generated settings.gradle (#1144). */
export const withKotlinShared: ConfigPlugin = (config) =>
  withSettingsGradle(config, (mod) => {
    mod.modResults.contents = includeKotlinShared(mod.modResults.contents);
    return mod;
  });
