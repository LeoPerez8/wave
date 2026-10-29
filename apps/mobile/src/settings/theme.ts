import {
  DEFAULT_THEME_CHOICE,
  appearanceAccent,
  chooseCustomInk,
  createColourPickerPreview,
  launcherIconFor,
  launcherIconSwitch,
  launchTheme,
  readThemeChoice,
  resolveThemeChange,
  themeFor,
  type Appearance,
  type AlertChoice,
  type ColourPickerPreview,
  type InkGroup,
  type LauncherIconSwitch,
  type Theme,
  type ThemeChoice,
  type ThemeColors,
  type ThemeGroup,
  type ThemeState,
} from "@wave/core";
import { Uniwind } from "uniwind";

import { persistedSetting, sameFields } from "@/lib/persistedSetting";
import { WaveNative } from "@/native/waveNative";
import { WavePlayer } from "@/native/wavePlayer";

import { followAppearance, getAppearance } from "./appearance";
import {
  LAUNCHER,
  getLauncherIcon,
  setLauncherIcon,
  showLauncherIcon,
  useStoredLauncherIcon,
} from "./launcherIcon";

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
 * notification takes the primary, and the launcher keeps this phone's stored
 * icon. The launch splash (the choice's grounds, the icon's waves) is also
 * saved natively, since Android draws it before this code runs; on every start
 * too, so it never drifts.
 */
const apply = (choice: ThemeChoice): void => {
  const theme = themeFor(choice);
  recolour(theme);
  colourNotification(theme, getAppearance());
  const icon = getLauncherIcon(choice);
  showLauncherIcon(icon);
  WaveNative.setLaunchTheme(launchTheme(choice, icon)).catch((error: unknown) =>
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

/** Yes switches the icon too; No keeps it; dismissal cancels the colour change. */
export type Confirm = (warning: LauncherIconSwitch["warning"]) => Promise<AlertChoice>;

/**
 * Switches to `next`, asking whether to change the icon when the new colours
 * would differ from this phone's icon. Dismissal keeps both as they were.
 */
const changeTheme = async (next: ThemeChoice, confirm: Confirm): Promise<void> => {
  const current = { choice: theme.get(), icon: getLauncherIcon(theme.get()) };
  const change = launcherIconSwitch(current.icon, next, LAUNCHER);
  // No prompt: the new colours give the stored icon, so keeping it is the same as switching.
  const answer = change === null ? "alternative" : await confirm(change.warning);
  if (answer === "dismiss") return;
  const result = resolveThemeChange(current, next, answer);
  setLauncherIcon(result.icon);
  const unchanged = sameFields(theme.get(), result.choice);
  theme.set(result.choice);
  if (unchanged) apply(result.choice);
};

/** Picks a swatch for one group. */
export const setThemeSwatch = async (
  group: ThemeGroup,
  id: string,
  confirm: Confirm,
): Promise<void> => {
  // Read back through Core so an unknown id lands on the default.
  const next = readThemeChoice(JSON.stringify({ ...theme.get(), [group]: id }));
  if (group === "light" || group === "dark") theme.set(next);
  else await changeTheme(next, confirm);
};

let preview: ColourPickerPreview | null = null;

/**
 * Starts recolouring the app with the group's custom colour as the picker
 * moves, without keeping it: the notification, the launcher icon and the
 * splash wait for Done. A drag recolours only once the finger rests or lifts
 * (Core's `createColourPickerPreview`), since a recolour re-renders every
 * themed view. [applied] hears each colour the app takes.
 */
export const previewCustomInk = (
  group: InkGroup,
  applied: (hex: string) => void = () => {},
): ColourPickerPreview => {
  preview?.stop();
  preview = createColourPickerPreview({
    apply: (hex) => {
      recolour(themeFor(chooseCustomInk(theme.get(), group, hex)));
      applied(hex);
    },
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

/** Puts the shipped colours back, asking first when the stored icon isn't the shipped one. */
export const resetTheme = (confirm: Confirm): Promise<void> =>
  changeTheme(DEFAULT_THEME_CHOICE, confirm);

/** The persisted theme choice; re-renders when Settings changes it. */
export const useThemeChoice = theme.useValue;

/** The persisted theme choice with this phone's icon; re-renders when either changes. */
export const useThemeState = (): ThemeState => {
  const choice = theme.useValue();
  const icon = useStoredLauncherIcon();
  return { choice, icon: icon ?? launcherIconFor(choice) };
};
