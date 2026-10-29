import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { withAndroidManifest, withDangerousMod, type ConfigPlugin } from "expo/config-plugins";

import { addShareShortcuts, shareShortcutFiles } from "./shareShortcut.ts";

/**
 * Prebuild: writes Import to Wave's share target and Recognize Song's static shortcut,
 * points every launcher entry at them, and registers the Recognize Quick Settings tile.
 * Apply it before
 * `withLauncherIcons`: Expo runs mods in reverse order, and this one needs the
 * launcher icons' aliases declared.
 */
export const withShareShortcut: ConfigPlugin = (config) => {
  const packageName = config.android?.package;
  if (packageName === undefined) throw new Error("withShareShortcut needs android.package");
  const withPointers = withAndroidManifest(config, (mod) => {
    mod.modResults = addShareShortcuts(mod.modResults);
    return mod;
  });
  return withDangerousMod(withPointers, [
    "android",
    (mod) => {
      const res = join(mod.modRequest.platformProjectRoot, "app", "src", "main", "res");
      for (const [path, contents] of Object.entries(shareShortcutFiles(packageName))) {
        const file = join(res, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, contents);
      }
      return mod;
    },
  ]);
};
