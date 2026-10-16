import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { withAppBuildGradle, withDangerousMod, type ConfigPlugin } from "expo/config-plugins";

import { addProfileInstaller, artProfileFiles } from "./artProfiles.ts";

/**
 * Prebuild: ships Wave's own ART profiles from `profiles/` (baseline and startup) and a
 * profileinstaller that installs them on a sideloaded APK on current Android (#317).
 */
export const withArtProfiles: ConfigPlugin = (config) => {
  const withInstaller = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = addProfileInstaller(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(withInstaller, [
    "android",
    (mod) => {
      const profiles = join(mod.modRequest.projectRoot, "profiles");
      const read = (name: string): string | null => {
        const file = join(profiles, name);
        return existsSync(file) ? readFileSync(file, "utf8") : null;
      };
      for (const { path, contents } of artProfileFiles(read)) {
        const file = join(mod.modRequest.platformProjectRoot, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, contents);
      }
      return mod;
    },
  ]);
};
