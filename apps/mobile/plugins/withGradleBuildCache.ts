import { withGradleProperties, type ConfigPlugin } from "expo/config-plugins";

import { addBuildCacheProperties } from "./gradleProperties.ts";

/**
 * Prebuild: turns on Gradle's build cache and gives Gradle more heap in the
 * generated gradle.properties, so a CI build reuses outputs from main's (#185).
 */
export const withGradleBuildCache: ConfigPlugin = (config) =>
  withGradleProperties(config, (mod) => {
    mod.modResults = addBuildCacheProperties(mod.modResults);
    return mod;
  });
