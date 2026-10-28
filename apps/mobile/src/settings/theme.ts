import {
  DEFAULT_THEME_CHOICE,
  appearanceAccent,
  chooseCustomInk,
  createColourPickerPreview,
  launcherIconSwitch,
  launchTheme,
  readThemeChoice,
  themeFor,
  type Appearance,
  type ColourPickerPreview,
  type InkGroup,
  type LauncherIconSwitch,
  type Theme,
  type ThemeChoice,
  type ThemeColors,
  type ThemeGroup,
} from "@wave/core";
import { Uniwind } from "uniwind";

import { persistedSetting, sameFields } from "@/lib/persistedSetting";
import { WaveNative } from "@/native/waveNative";
import { WavePlayer } from "@/native/wavePlayer";

import { followAppearance, getAppearance } from "./appearance";
import { LAUNCHER, showLauncherIconFor } from "./launcherIcon";

/** The colours as CSS variables (`--color-<token>`), the names global.css declares. */
const cssVariables = (colors: ThemeColors): Record<string, string> =>
  Object.fromEntries(Object.entries(colors).map(([token, value]) => [`--color-${token}`, value]));

/** The media notification takes the primary in the scheme Wave shows (Settings › Appearance). */
const colourNotification = (theme: Theme, appearance: Appearance): void => {
  const accent = appearanceAccent(theme, appearance);
  WavePlayer.setNotificationAccent(accent.light, accent.dark).catch((error: unknown) =>
    console.warn("[wave] Couldn't colour the notification", error),
  );
};

/**
 * Lays a theme over global.css's defaults. Every className and
 * `useThemeColor` reader (glass tint, native props) re-renders with it.
 */
const recolour = (theme: Theme): void => {
  Uniwind.updateCSSVariables("light", cssVariables(theme.light));
  Uniwind.updateCSSVariables("dark", cssVariables(theme.dark));
};

/**
 * Lays the chosen colours over global.css's defaults (`recolour`), the media
 * notification takes the primary, and the launcher icon follows the primary
 * and secondary (custom colours take their palette inks, Core's `inkPairFor`). The choice is also
 * saved natively for the launch splash, which Android draws before this code
 * runs; on every start too, so it never drifts.
 */
const apply = (choice: ThemeChoice): void => {
  const theme = themeFor(choice);
  recolour(theme);
  colourNotification(theme, getAppearance());
  showLauncherIconFor(choice);
  WaveNative.setLaunchTheme(launchTheme(choice)).catch((error: unknown) =>
    console.warn("[wave] Saving the launch theme failed", error),
  );
};

const theme = persistedSetting<ThemeChoice>({
  key: "settings.theme",
  synced: true,
  read: readThemeChoice,
  write: (choice) => JSON.stringify(choice),
  equals: sameFields,
  onValue: apply,
});

// Applied on import (the root layout imports this first), before anything renders.
theme.get();

followAppearance((appearance) => colourNotification(themeFor(theme.get()), appearance));

/** Asks the person to agree to a change (`confirmAction`); resolves whether they did. */
export type Confirm = (warning: NonNullable<LauncherIconSwitch["warning"]>) => Promise<boolean>;

/**
 * Switches to `next`; the whole app recolours at once. When that switches the
 * launcher icon and the launcher drops the home-screen icon on a switch,
 * `confirm` is asked first, and nothing changes unless it agrees.
 */
const changeTheme = async (next: ThemeChoice, confirm: Confirm): Promise<void> => {
  const warning = launcherIconSwitch(theme.get(), next, LAUNCHER)?.warning ?? null;
  if (warning !== null && !(await confirm(warning))) return;
  theme.set(next);
};

/** Picks a swatch for one group. */
export const setThemeSwatch = (group: ThemeGroup, id: string, confirm: Confirm): Promise<void> =>
  // Read back through Core so an unknown id lands on the default.
  changeTheme(readThemeChoice(JSON.stringify({ ...theme.get(), [group]: id })), confirm);

let preview: ColourPickerPreview | null = null;

/**
 * Starts recolouring the app with the group's custom colour as the picker
 * moves, without keeping it: the notification, the launcher icon and the
 * splash wait for Done. A drag recolours only once the finger rests or lifts
 * (Core's `createColourPickerPreview`), since a recolour re-renders every
 * themed view.
 */
export const previewCustomInk = (group: InkGroup): ColourPickerPreview => {
  preview?.stop();
  preview = createColourPickerPreview({
    apply: (hex) => recolour(themeFor(chooseCustomInk(theme.get(), group, hex))),
    now: Date.now,
    wait: (ms, done) => {
      const timer = setTimeout(done, ms);
      return () => clearTimeout(timer);
    },
  });
  return preview;
};

/** Ends a preview: the app goes back to the kept colours (or the ones Done just kept). */
const endPreview = (): void => {
  preview?.stop();
  preview = null;
  recolour(themeFor(theme.get()));
};

/** The picker closed without Done: the colours go back to what they were. */
export const cancelCustomInk = (): void => endPreview();

/**
 * Keeps `hex` as the group's custom colour and chooses it (Done in the
 * picker), asking first when that switches the launcher icon.
 */
export const setCustomInk = async (
  group: InkGroup,
  hex: string,
  confirm: Confirm,
): Promise<void> => {
  try {
    await changeTheme(chooseCustomInk(theme.get(), group, hex), confirm);
  } finally {
    endPreview();
  }
};

/** Puts the shipped theme back, teal-over-amber icon and no custom colours. */
export const resetTheme = (confirm: Confirm): Promise<void> =>
  changeTheme(DEFAULT_THEME_CHOICE, confirm);

/** The persisted theme choice; re-renders when Settings changes it. */
export const useThemeChoice = theme.useValue;
