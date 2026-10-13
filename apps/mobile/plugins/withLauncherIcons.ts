import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { withAndroidManifest, withDangerousMod, type ConfigPlugin } from "expo/config-plugins";

import { addLauncherAliases, launcherIconFiles } from "./launcherIcons.ts";

/**
 * Prebuild: declares a launcher activity alias per primary × secondary and
 * writes their adaptive icons into the generated Android project, so
 * Settings › Theme can switch Wave's home-screen icon (#101).
 */
export const withLauncherIcons: ConfigPlugin = (config) => {
  const withAliases = withAndroidManifest(config, (mod) => {
    mod.modResults = addLauncherAliases(mod.modResults);
    return mod;
  });
  return withDangerousMod(withAliases, [
    "android",
    (mod) => {
      const res = join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res");
      for (const [path, contents] of Object.entries(launcherIconFiles())) {
        const file = join(res, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, contents);
      }
      return mod;
    },
  ]);
};
