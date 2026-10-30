import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { DEFAULT_THEME_CHOICE, type LaunchTheme } from "@wave/core";

// Exercise the actual settings and persistence. Only Android, SQLite KV and
// Uniwind are replaced at their platform boundaries.
let fixtureId = 0;
/**
 * Loads the settings on a phone holding `stored`. `launchThemeSaved`: an
 * earlier Wave ran here and saved its launch theme natively (an update).
 * `appliedAlias`: the launcher alias an earlier Wave last left on.
 */
const loadTheme = async (
  stored: Record<string, string> = {},
  {
    launchThemeSaved = false,
    appliedAlias = null,
  }: { launchThemeSaved?: boolean; appliedAlias?: string | null } = {},
) => {
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
      hasLaunchTheme: () => ${launchThemeSaved},
      appliedLauncherAlias: () => ${JSON.stringify(appliedAlias)},
    };
    export const phoneLanguages = () => [];
    export const subscribePhoneLanguages = () => () => {};
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
  await theme.setCustomInk("primary", "#f08cb0", async () => "alternative");
  assert.equal(device.css.dark?.["--color-accent"], "#f08cb0");
  assert.equal(device.alias, "LauncherIcon_white_white");
  assert.equal(device.launch.dark.primary, "#ffffff");
  assert.equal(device.launch.dark.secondary, "#ffffff");
});

const unexpected = async (): Promise<never> => {
  throw new Error("Background changes must not ask");
};

test("background changes never ask about an icon left different by No", async () => {
  const { theme, device } = await loadTheme();
  await theme.setCustomInk("primary", "#f08cb0", async () => "alternative");
  await theme.setThemeSwatch("dark", "forest", unexpected);
  await theme.setThemeSwatch("light", "sand", unexpected);
  assert.equal(device.css.dark?.["--color-background"], "#0a130d");
  assert.equal(device.launch.light.background, "#ede6da");
  assert.equal(device.launch.dark.background, "#0a130d");
  assert.equal(device.alias, "LauncherIcon_white_white");
});

test("a preset or custom install keeps its icon on migration and on a later start", async () => {
  for (const choice of [
    { ...DEFAULT_THEME_CHOICE, primary: "violet", secondary: "sky" },
    { ...DEFAULT_THEME_CHOICE, primary: "custom", customPrimary: "#00e9ff" },
  ]) {
    const expected = choice.primary === "custom" ? "vivid209_white" : "violet_sky";
    const first = await loadTheme({ "settings.theme": JSON.stringify(choice) });
    assert.equal(first.device.alias, `LauncherIcon_${expected}`);
    assert.equal(first.Storage.getItemSync("settings.launcherIcon"), expected);
    await first.theme.setCustomInk("primary", "#f08cb0", async () => "alternative");
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
  assert.equal(device.alias, "LauncherIcon_violet_white");
  assert.equal(device.launch.dark.primary, "#a99af0");
  assert.equal(device.launch.dark.background, "#0a130d");
  assert.equal(settings.applySyncedSetting("settings.launcherIcon", "rose_gold"), false);
  assert.equal(Storage.getItemSync("settings.launcherIcon"), "violet_white");
  assert.equal(JSON.parse(settings.syncedSettingValue("settings.theme")!).icon, undefined);
  assert.deepEqual(changed, []);
});

test("Yes saves the selected icon, No asks again on the next colour, and dismissal cancels", async () => {
  const { theme, device, Storage } = await loadTheme();
  await theme.setCustomInk("primary", "#f08cb0", async () => "alternative");
  let asked = false;
  await theme.setCustomInk("secondary", "#7cc4ea", async (prompt) => {
    asked = true;
    assert.equal(prompt.title, "Change the app icon too?");
    assert.match(prompt.message, /home screen.*app drawer/);
    return "dismiss";
  });
  assert.equal(asked, true);
  assert.equal(device.css.dark?.["--color-highlight"], "#ffffff");
  assert.equal(device.alias, "LauncherIcon_white_white");
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
  assert.equal(device.alias, "LauncherIcon_white_white");
  assert.equal(device.launch.dark.primary, "#ffffff");
  assert.equal(Storage.getItemSync("settings.launcherIcon"), "white_white");
});

test("colours matching the stored icon need no prompt even if the old colours differ", async () => {
  const { theme, device } = await loadTheme({ "settings.launcherIcon": "rose_white" });
  await theme.setCustomInk("primary", "#f08cb0", async () => {
    throw new Error("Already this icon");
  });
  assert.equal(device.css.dark?.["--color-accent"], "#f08cb0");
  assert.equal(device.alias, "LauncherIcon_rose_white");
});

test("a fresh install starts on white colours and the white-on-black icon and splash (#793)", async () => {
  const { device, Storage } = await loadTheme();
  assert.equal(device.css.dark?.["--color-accent"], "#ffffff");
  assert.equal(device.css.dark?.["--color-highlight"], "#ffffff");
  assert.equal(device.css.light?.["--color-accent"], "#121b1d");
  assert.equal(device.css.light?.["--color-highlight"], "#121b1d");
  assert.equal(device.alias, "LauncherIcon_white_white");
  assert.deepEqual(device.launch, {
    splashTheme: null,
    light: { background: "#e0ecef", primary: "#121b1d", secondary: "#121b1d" },
    dark: { background: "#000000", primary: "#ffffff", secondary: "#ffffff" },
  });
  assert.equal(Storage.getItemSync("settings.theme"), null);
  assert.equal(Storage.getItemSync("settings.launcherIcon"), "white_white");
});

test("an update from before white, with nothing stored, keeps teal over ember and its icon", async () => {
  const first = await loadTheme({}, { launchThemeSaved: true });
  assert.equal(first.device.css.dark?.["--color-accent"], "#59c0ad");
  assert.equal(first.device.css.dark?.["--color-highlight"], "#ec9d53");
  assert.equal(first.device.alias, "LauncherIcon_teal_ember");
  assert.equal(first.device.launch.splashTheme, "Wl.0.0.0.6");
  assert.equal(first.Storage.getItemSync("settings.launcherIcon"), "teal_ember");
  const stored = first.Storage.getItemSync("settings.theme");
  // Stored as Teal and Ember read since saved colours (#794): custom, and saved.
  assert.equal(JSON.parse(stored ?? "{}").customPrimary, "#59c0ad");
  assert.deepEqual(JSON.parse(stored ?? "{}").savedSecondary, ["#ec9d53"]);
  assert.equal(first.settings.syncedSettingValue("settings.theme"), stored);
  // The next start has the native launch theme too, and keeps what the first stored.
  const next = await loadTheme(
    { "settings.theme": stored!, "settings.launcherIcon": "teal_ember" },
    { launchThemeSaved: true },
  );
  assert.equal(next.device.css.dark?.["--color-accent"], "#59c0ad");
  assert.equal(next.device.alias, "LauncherIcon_teal_ember");
});

test("a fresh install's later starts stay white", async () => {
  const first = await loadTheme();
  const next = await loadTheme(
    { "settings.launcherIcon": first.Storage.getItemSync("settings.launcherIcon")! },
    { launchThemeSaved: true },
  );
  assert.equal(next.device.css.dark?.["--color-accent"], "#ffffff");
  assert.equal(next.device.alias, "LauncherIcon_white_white");
  assert.equal(next.Storage.getItemSync("settings.theme"), null);
});

test("the Default swatch picks white, asking about the icon like any colour", async () => {
  const { theme, device } = await loadTheme({
    "settings.theme": JSON.stringify({
      ...DEFAULT_THEME_CHOICE,
      primary: "rose",
      secondary: "gold",
    }),
    "settings.launcherIcon": "rose_gold",
  });
  let asked = 0;
  await theme.setThemeSwatch("primary", "white", async () => {
    asked++;
    return "action";
  });
  assert.equal(device.css.dark?.["--color-accent"], "#ffffff");
  assert.equal(device.alias, "LauncherIcon_white_gold");
  await theme.setThemeSwatch("secondary", "white", async () => {
    asked++;
    return "alternative";
  });
  assert.equal(device.css.dark?.["--color-highlight"], "#ffffff");
  assert.equal(device.alias, "LauncherIcon_white_gold");
  assert.equal(asked, 2);
});

test("reset lands on white and asks about the icon only when it isn't white yet", async () => {
  const kept = await loadTheme({
    "settings.theme": JSON.stringify({ ...DEFAULT_THEME_CHOICE, primary: "rose" }),
    "settings.launcherIcon": "white_white",
  });
  await kept.theme.resetTheme(async () => {
    throw new Error("The icon is already white");
  });
  assert.equal(kept.device.css.dark?.["--color-accent"], "#ffffff");
  // Rose, a former preset, was read as a saved colour (#794), which reset keeps.
  assert.equal(
    kept.Storage.getItemSync("settings.theme"),
    JSON.stringify({ ...DEFAULT_THEME_CHOICE, savedPrimary: ["#f08cb0"] }),
  );

  const teal = await loadTheme({}, { launchThemeSaved: true });
  let asked = false;
  await teal.theme.resetTheme(async () => {
    asked = true;
    return "action";
  });
  assert.equal(asked, true);
  assert.equal(teal.device.css.dark?.["--color-accent"], "#ffffff");
  assert.equal(teal.device.alias, "LauncherIcon_white_white");
});

test("a preset install's colours become saved ones, its icon kept with no prompt on the next change (#794)", async () => {
  const { theme, device, settings } = await loadTheme({
    "settings.theme": JSON.stringify({
      ...DEFAULT_THEME_CHOICE,
      primary: "violet",
      secondary: "sky",
    }),
  });
  assert.equal(device.css.dark?.["--color-accent"], "#a99af0");
  assert.equal(device.css.light?.["--color-accent"], "#5b4bb7");
  assert.equal(device.alias, "LauncherIcon_violet_sky");
  const synced = JSON.parse(settings.syncedSettingValue("settings.theme")!);
  assert.deepEqual([synced.savedPrimary, synced.savedSecondary], [["#a99af0"], ["#7cc4ea"]]);
  // A background change and picking its own saved colour again leave the icon as it was.
  await theme.setThemeSwatch("dark", "navy", unexpected);
  await theme.setSavedInk("primary", "#a99af0", unexpected);
  assert.equal(device.alias, "LauncherIcon_violet_sky");
});

test("Save keeps the picker's colour for its row without applying it, and syncs it", async () => {
  const { theme, device, settings, Storage } = await loadTheme();
  const changed: string[] = [];
  settings.onSyncedSettingChange((key) => changed.push(key));
  const preview = theme.previewCustomInk("primary");
  preview.pick("#ff0d00");
  const previewing = device.css.dark?.["--color-accent"];
  assert.notEqual(previewing, "#ffffff");
  theme.saveCustomInk("primary", "#ff0d00");
  // The picker stays open on its colour; Save neither applies nor drops it.
  assert.equal(device.css.dark?.["--color-accent"], previewing);
  assert.deepEqual(JSON.parse(Storage.getItemSync("settings.theme")!).savedPrimary, ["#ff0d00"]);
  assert.deepEqual(changed, ["settings.theme"]);
  theme.cancelCustomInk();
  assert.equal(device.css.dark?.["--color-accent"], "#ffffff");
  assert.equal(device.alias, "LauncherIcon_white_white");
});

test("a saved colour applies at once, asking about the icon like any colour", async () => {
  const { theme, device } = await loadTheme({
    "settings.theme": JSON.stringify({ ...DEFAULT_THEME_CHOICE, savedSecondary: ["#ff0d00"] }),
  });
  let asked = 0;
  await theme.setSavedInk("secondary", "#ff0d00", async () => {
    asked++;
    return "action";
  });
  assert.equal(asked, 1);
  assert.notEqual(device.css.dark?.["--color-highlight"], "#ffffff");
  assert.equal(device.alias, "LauncherIcon_white_vivid29");
});

test("removing the saved colour in use keeps the app's colours and icon", async () => {
  const { theme, device, Storage } = await loadTheme({
    "settings.theme": JSON.stringify({
      ...DEFAULT_THEME_CHOICE,
      primary: "custom",
      customPrimary: "#f08cb0",
      savedPrimary: ["#3a7bd5", "#f08cb0"],
    }),
  });
  theme.removeSavedInk("primary", "#f08cb0");
  assert.equal(device.css.dark?.["--color-accent"], "#f08cb0");
  assert.equal(device.alias, "LauncherIcon_rose_white");
  const stored = JSON.parse(Storage.getItemSync("settings.theme")!);
  assert.deepEqual(stored.savedPrimary, ["#3a7bd5"]);
  assert.equal(stored.customPrimary, "#f08cb0");
});

test("reset keeps the saved colours", async () => {
  const { theme, device, Storage } = await loadTheme({
    "settings.theme": JSON.stringify({
      ...DEFAULT_THEME_CHOICE,
      primary: "custom",
      customPrimary: "#f08cb0",
      savedPrimary: ["#f08cb0"],
      savedSecondary: ["#7cc4ea"],
    }),
    "settings.launcherIcon": "white_white",
  });
  await theme.resetTheme(unexpected);
  assert.equal(device.css.dark?.["--color-accent"], "#ffffff");
  const stored = JSON.parse(Storage.getItemSync("settings.theme")!);
  assert.deepEqual([stored.primary, stored.customPrimary], ["white", null]);
  assert.deepEqual([stored.savedPrimary, stored.savedSecondary], [["#f08cb0"], ["#7cc4ea"]]);
});

test("an update keeps the icon the earlier Wave left on, where this Wave would match another", async () => {
  // 0.36.2-ti matched this cream primary to gold; this Wave's matching takes white.
  const stored = {
    "settings.theme": JSON.stringify({
      ...DEFAULT_THEME_CHOICE,
      primary: "custom",
      customPrimary: "#fcddb8",
      secondary: "ember",
    }),
  };
  const updated = await loadTheme(stored, {
    launchThemeSaved: true,
    appliedAlias: "LauncherIcon_gold_ember",
  });
  assert.equal(updated.device.alias, "LauncherIcon_gold_ember");
  assert.equal(updated.Storage.getItemSync("settings.launcherIcon"), "gold_ember");
  // A fresh install with those colours (pulled, say) takes the icon they give.
  const fresh = await loadTheme(stored);
  assert.equal(fresh.device.alias, "LauncherIcon_white_ember");
});

test("an answer to the icon prompt keeps a theme pulled while it was open", async () => {
  const { theme, settings, device, Storage } = await loadTheme();
  const changed: string[] = [];
  settings.onSyncedSettingChange((key) => changed.push(key));
  await theme.setCustomInk("primary", "#f08cb0", async () => {
    settings.applySyncedSetting(
      "settings.theme",
      JSON.stringify({ ...DEFAULT_THEME_CHOICE, dark: "forest", savedSecondary: ["#7cc4ea"] }),
    );
    return "alternative";
  });
  const stored = JSON.parse(Storage.getItemSync("settings.theme")!);
  assert.equal(stored.dark, "forest");
  assert.deepEqual(stored.savedSecondary, ["#7cc4ea"]);
  assert.equal(stored.customPrimary, "#f08cb0");
  assert.equal(device.css.dark?.["--color-background"], "#0a130d");
  assert.equal(device.css.dark?.["--color-accent"], "#f08cb0");
  assert.deepEqual(changed, ["settings.theme"]);
});

test("Yes stores the icon of the colours as they are when it's answered", async () => {
  const { theme, settings, device } = await loadTheme();
  await theme.setCustomInk("primary", "#f08cb0", async () => {
    settings.applySyncedSetting(
      "settings.theme",
      JSON.stringify({ ...DEFAULT_THEME_CHOICE, secondary: "custom", customSecondary: "#7cc4ea" }),
    );
    return "action";
  });
  assert.equal(device.alias, "LauncherIcon_rose_sky");
});

test("a theme pulled from a Wave before saved colours keeps this phone's saved colours", async () => {
  const { settings, Storage } = await loadTheme({
    "settings.theme": JSON.stringify({
      ...DEFAULT_THEME_CHOICE,
      savedPrimary: ["#3a7bd5", "#00aa55"],
    }),
  });
  // That phone picked Blue, a preset it still offers, and pushes no saved colours.
  settings.applySyncedSetting(
    "settings.theme",
    JSON.stringify({ light: "fog", dark: "black", primary: "blue", secondary: "white" }),
  );
  const stored = JSON.parse(Storage.getItemSync("settings.theme")!);
  assert.equal(stored.customPrimary, "#7aaef5");
  assert.deepEqual(stored.savedPrimary, ["#7aaef5", "#3a7bd5", "#00aa55"]);
});

test("a saved colour keeps the unsaved custom colour on the Custom swatch, as Default does", async () => {
  const { theme, Storage } = await loadTheme({
    "settings.theme": JSON.stringify({ ...DEFAULT_THEME_CHOICE, savedPrimary: ["#ff8800"] }),
  });
  const kept = () => JSON.parse(Storage.getItemSync("settings.theme")!);
  await theme.setCustomInk("primary", "#3366ff", async () => "alternative");
  await theme.setSavedInk("primary", "#ff8800", async () => "alternative");
  assert.deepEqual([kept().customPrimary, kept().unsavedPrimary], ["#ff8800", "#3366ff"]);
  await theme.setThemeSwatch("primary", "white", async () => "alternative");
  assert.deepEqual([kept().primary, kept().customPrimary], ["white", "#3366ff"]);
});
