import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { withAndroidManifest, withDangerousMod, type ConfigPlugin } from "expo/config-plugins";

import { addAppLanguages, appLanguageFiles } from "./appLanguages.ts";

/** Prebuild declares the per-app languages and prevents Activity recreation for locale changes. */
export const withAppLanguages: ConfigPlugin = (config) => {
  const withManifest = withAndroidManifest(config, (mod) => {
    mod.modResults = addAppLanguages(mod.modResults);
    return mod;
  });
  return withDangerousMod(withManifest, [
    "android",
    (mod) => {
      const res = join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res");
      for (const [path, contents] of Object.entries(appLanguageFiles())) {
        const file = join(res, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, contents);
      }
      return mod;
    },
  ]);
};
