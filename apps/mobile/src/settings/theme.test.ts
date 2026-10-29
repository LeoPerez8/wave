import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { DEFAULT_THEME_CHOICE, type LaunchTheme } from "@wave/core";

// Exercise the actual settings and persistence. Only Android, SQLite KV and
// Uniwind are replaced at their platform boundaries.
let fixtureId = 0;
const loadTheme = async (stored: Record<string, string> = {}) => {
  const id = ++fixtureId;
  const boundary = `data:text/javascript,${encodeURIComponent(`
    export const fixture = ${id};
    const kept = new Map(Object.entries(${JSON.stringify(stored)}));
    export const Storage = {
      getItemSync: key => kept.get(key) ?? null,
      setItemSync: (key, value) => kept.set(key, value),
      removeItemSync: key => kept.delete(key),
    };
    export const device = { alias: null, launch: null, css: {} };
    export const Uniwind = {
      setTheme: () => {},
      updateCSSVariables: (mode, values) => { device.css[mode] = values; },
    };
    export const WaveNative = {
      setAppearance: async () => {},
      setLauncherIcon: async alias => { device.alias = alias; },
      setLaunchTheme: async theme => { device.launch = theme; },
    };
    export const WavePlayer = { setNotificationAccent: async () => {} };
    export const AppState = { addEventListener: () => ({ remove: () => {} }) };
    export const useColorScheme = () => "dark";
  `)}`;
  const src = new URL("../", import.meta.url);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        [
          "uniwind",
          "react-native",
          "expo-sqlite/kv-store",
          "@/native/waveNative",
          "@/native/wavePlayer",
        ].includes(specifier)
      )
        return { url: boundary, shortCircuit: true };
      if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), src).href;
      if (specifier.startsWith(".") || specifier.startsWith("file:")) {
        const url = new URL(specifier, context.parentURL);
        if (url.href.startsWith(src.href)) {
          if (!url.pathname.endsWith(".ts") && existsSync(new URL(`${url.pathname}.ts`, url)))
            url.pathname += ".ts";
          url.search = `fixture=${id}`;
          return nextResolve(url.href, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const theme = (await import(`./theme.ts?fixture=${id}`)) as typeof import("./theme.ts");
    const settings = (await import(
      `../lib/persistedSetting.ts?fixture=${id}`
    )) as typeof import("../lib/persistedSetting.ts");
    const { device, Storage } = (await import(boundary)) as {
      device: { alias: string; launch: LaunchTheme; css: Record<string, Record<string, string>> };
      Storage: { getItemSync: (key: string) => string | null };
    };
    return { theme, settings, device, Storage };
  } finally {
    hooks.deregister();
  }
};

test("No recolours the app while the launcher and both splash layers keep the stored icon", async () => {
  const { theme, device } = await loadTheme();
  await theme.setThemeSwatch("primary", "rose", async () => "alternative");
  assert.equal(device.css.dark?.["--color-accent"], "#f08cb0");
  assert.equal(device.alias, "LauncherIcon_teal_ember");
  assert.equal(device.launch.dark.primary, "#14b7a6");
  assert.equal(device.launch.dark.secondary, "#f5b83d");
});

const unexpected = async (): Promise<never> => {
  throw new Error("Background changes must not ask");
};

test("background changes never ask about an icon left different by No", async () => {
  const { theme, device } = await loadTheme();
  await theme.setThemeSwatch("primary", "rose", async () => "alternative");
  await theme.setThemeSwatch("dark", "forest", unexpected);
  await theme.setThemeSwatch("light", "sand", unexpected);
  assert.equal(device.css.dark?.["--color-background"], "#0a130d");
  assert.equal(device.launch.light.background, "#ede6da");
  assert.equal(device.launch.dark.background, "#0a130d");
  assert.equal(device.alias, "LauncherIcon_teal_ember");
});

test("a preset or custom install keeps its icon on migration and on a later start", async () => {
  for (const choice of [
    { ...DEFAULT_THEME_CHOICE, primary: "violet", secondary: "sky" },
    { ...DEFAULT_THEME_CHOICE, primary: "custom", customPrimary: "#00e9ff" },
  ]) {
    const expected = choice.primary === "custom" ? "vivid209_ember" : "violet_sky";
    const first = await loadTheme({ "settings.theme": JSON.stringify(choice) });
    assert.equal(first.device.alias, `LauncherIcon_${expected}`);
    assert.equal(first.Storage.getItemSync("settings.launcherIcon"), expected);
    await first.theme.setThemeSwatch("primary", "rose", async () => "alternative");
    const next = await loadTheme({
      "settings.theme": first.Storage.getItemSync("settings.theme")!,
      "settings.launcherIcon": first.Storage.getItemSync("settings.launcherIcon")!,
    });
    assert.equal(next.device.alias, `LauncherIcon_${expected}`);
  }
});

test("a pulled theme recolours the app but cannot change or sync this phone's icon", async () => {
  const { settings, device, Storage } = await loadTheme({
    "settings.theme": JSON.stringify({ ...DEFAULT_THEME_CHOICE, primary: "violet" }),
  });
  const changed: string[] = [];
  settings.onSyncedSettingChange((key) => changed.push(key));
  assert.equal(
    settings.applySyncedSetting(
      "settings.theme",
      JSON.stringify({ ...DEFAULT_THEME_CHOICE, primary: "rose", dark: "forest" }),
    ),
    true,
  );
  assert.equal(device.css.dark?.["--color-accent"], "#f08cb0");
  assert.equal(device.alias, "LauncherIcon_violet_ember");
  assert.equal(device.launch.dark.primary, "#a99af0");
  assert.equal(device.launch.dark.background, "#0a130d");
  assert.equal(settings.applySyncedSetting("settings.launcherIcon", "rose_gold"), false);
  assert.equal(Storage.getItemSync("settings.launcherIcon"), "violet_ember");
  assert.equal(JSON.parse(settings.syncedSettingValue("settings.theme")!).icon, undefined);
  assert.deepEqual(changed, []);
});

test("Yes saves the selected icon, No asks again on the next colour, and dismissal cancels", async () => {
  const { theme, device, Storage } = await loadTheme();
  await theme.setThemeSwatch("primary", "rose", async () => "alternative");
  let asked = false;
  await theme.setThemeSwatch("secondary", "sky", async (prompt) => {
    asked = true;
    assert.equal(prompt.title, "Change the app icon too?");
    assert.match(prompt.message, /home screen.*app drawer/);
    return "dismiss";
  });
  assert.equal(asked, true);
  assert.equal(device.css.dark?.["--color-highlight"], "#ec9d53");
  assert.equal(device.alias, "LauncherIcon_teal_ember");
  await theme.setCustomInk("secondary", "#ff0d00", async () => "action");
  assert.equal(device.alias, "LauncherIcon_rose_vivid29");
  assert.equal(Storage.getItemSync("settings.launcherIcon"), "rose_vivid29");
  assert.equal(device.launch.dark.secondary, "#ff1a1d");
});

test("reset uses the prompt even when only the icon differs from defaults", async () => {
  const { theme, device, Storage } = await loadTheme({ "settings.launcherIcon": "rose_sky" });
  await theme.resetTheme(async () => "dismiss");
  assert.equal(device.alias, "LauncherIcon_rose_sky");
  await theme.resetTheme(async () => "alternative");
  assert.equal(device.alias, "LauncherIcon_rose_sky");
  await theme.resetTheme(async () => "action");
  assert.equal(device.alias, "LauncherIcon_teal_ember");
  assert.equal(device.launch.dark.primary, "#14b7a6");
  assert.equal(Storage.getItemSync("settings.launcherIcon"), "teal_ember");
});

test("colours matching the stored icon need no prompt even if the old colours differ", async () => {
  const { theme, device } = await loadTheme({ "settings.launcherIcon": "rose_ember" });
  await theme.setThemeSwatch("primary", "rose", async () => {
    throw new Error("Already this icon");
  });
  assert.equal(device.css.dark?.["--color-accent"], "#f08cb0");
  assert.equal(device.alias, "LauncherIcon_rose_ember");
});
