/**
 * The launcher icon: two waves on black, the top one in the chosen primary and
 * the bottom one in the chosen secondary. Android can't recolour a launcher
 * icon at runtime, so Wave ships one icon per primary × secondary and switches
 * between them.
 */

import { en, type Catalogue } from "./catalogueEn.ts";
import type { AlertChoice, AlertSpec } from "./alert.ts";
import { LOGO_WAVES, logoIconPaths, logoWaveY } from "./logo.ts";
import { INK_PAIRS, inkPairFor } from "./inkPalette.ts";
import { DEFAULT_THEME_CHOICE, isDefaultThemeChoice, type ThemeChoice } from "./themeChoice.ts";

/** One launcher icon: a primary × secondary pair and the colours its waves take on black. */
export interface LauncherIcon {
  /** `<primary>_<secondary>`; the icon's Android resources and activity alias are named after it. */
  readonly id: string;
  readonly primary: string;
  readonly secondary: string;
  /** The top wave, `#rrggbb`. */
  readonly top: string;
  /** The bottom wave, `#rrggbb`. */
  readonly bottom: string;
}

const shippedPair = inkPairFor(DEFAULT_THEME_CHOICE);

/** Every palette pair, the shipped icon first. */
export const LAUNCHER_ICONS: readonly LauncherIcon[] = [
  shippedPair,
  ...INK_PAIRS.filter((pair) => pair.id !== shippedPair.id),
].map(({ id, primary, secondary }) => ({
  id,
  primary: primary.id,
  secondary: secondary.id,
  top: primary.dark,
  bottom: secondary.dark,
}));

/**
 * The icon the manifest turns on, for good: teal over ember, the shipped icon
 * before white (#793). Android keeps an alias Wave never switched at its
 * manifest state, so an install that always showed teal over ember has that
 * alias on only through the manifest; turning another on there would swap
 * its icon on update, and the launcher would drop it from the home screen.
 * A fresh install starts on it and switches to its own icon (white) the
 * first time Wave leaves the screen.
 */
export const MANIFEST_LAUNCHER_ICON: LauncherIcon = LAUNCHER_ICONS.find(
  (icon) => icon.id === "teal_ember",
)!;

/** Furthest any stroke edge of the logo reaches from its centre, in the logo's units. */
const LOGO_EXTENT = (() => {
  let max = 0;
  for (const wave of ["top", "bottom"] as const)
    for (let i = 0; i <= 240; i++) {
      const x = -1 + i / 120;
      max = Math.max(max, Math.hypot(x, logoWaveY(wave, x)));
    }
  return max + LOGO_WAVES.stroke / 2;
})();

/**
 * How far from the centre the logo reaches on a 108dp adaptive-icon layer, as a
 * fraction of its width. Every mask keeps at least the middle 66dp circle
 * (0.305 of the width), so 0.27 leaves a margin. The shipped PNG icons
 * (`apps/mobile/scripts/render-icons.ts`) use it too.
 */
export const LAUNCHER_ICON_RADIUS = 0.27;

/**
 * The launcher icon's waves (Core's logo) as vector paths on the adaptive
 * icon's 108dp foreground layer: each is stroked `strokeWidth` wide with round
 * caps, in its icon's colour (or white for the monochrome themed icon).
 */
export const LAUNCHER_ICON_ART: {
  readonly viewport: 108;
  readonly strokeWidth: number;
  readonly top: string;
  readonly bottom: string;
} = (() => {
  const viewport = 108;
  const scale = (LAUNCHER_ICON_RADIUS * viewport) / LOGO_EXTENT;
  // `logoIconPaths` fits the logo's width, caps included, between two insets.
  const inset = (viewport - scale * (2 + LOGO_WAVES.stroke)) / 2;
  const { top, bottom, stroke } = logoIconPaths({ size: viewport, inset });
  return { viewport, strokeWidth: Number(stroke.toFixed(3)), top, bottom };
})();

/**
 * The icon a theme choice shows: presets keep their own ink; custom colours
 * take their shared palette match, with the pastel guard.
 */
export const launcherIconFor = (choice: ThemeChoice): LauncherIcon => {
  const { id } = inkPairFor(choice);
  return LAUNCHER_ICONS.find((icon) => icon.id === id)!;
};

/** What this phone holds when Wave starts, for `launcherIconOnStart`. */
export interface StartingIconState {
  /** The stored launcher icon's id (`settings.launcherIcon`); null when none is. */
  readonly storedIcon: string | null;
  /**
   * The id of the icon whose alias an earlier Wave last left on (the native
   * switcher's record), whatever build wrote it; null when none did.
   */
  readonly appliedIcon: string | null;
  /** Whether an earlier Wave saved a launch theme natively, as it did on every start. */
  readonly launchThemeSaved: boolean;
  /** The theme choice Wave starts with. */
  readonly choice: ThemeChoice;
}

const iconById = (id: string | null): LauncherIcon | undefined =>
  LAUNCHER_ICONS.find((icon) => icon.id === id);

/**
 * This phone's icon when Wave starts: the stored one; on the update that
 * brought the stored icon, the one the phone shows (the alias the earlier
 * Wave left on, else the manifest's), since the colours' icon may have moved
 * with this Wave's matching and switching would drop it from the home
 * screen; on a fresh install, the one its colours give.
 */
export const launcherIconOnStart = ({
  storedIcon,
  appliedIcon,
  launchThemeSaved,
  choice,
}: StartingIconState): LauncherIcon =>
  iconById(storedIcon) ??
  (launchThemeSaved ? (iconById(appliedIcon) ?? MANIFEST_LAUNCHER_ICON) : launcherIconFor(choice));

/** What the launcher does when Wave switches icons. */
export interface LauncherBehaviour {
  /** It removes Wave's icon from the home screen (the app drawer gets the new one). */
  readonly dropsHomeScreenIcon: boolean;
}

/** A theme change that switches the launcher icon. */
export interface LauncherIconSwitch {
  readonly icon: LauncherIcon;
  /** Asked before the colours change; No keeps the icon, dismissal cancels both. */
  readonly warning: AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> };
}

/** Whether the next colours differ from this phone's stored icon, and what to ask first. */
export const launcherIconSwitch = (
  from: LauncherIcon,
  to: ThemeChoice,
  launcher: LauncherBehaviour,
  { settings: { launcherIcon: text } }: Catalogue = en,
): LauncherIconSwitch | null => {
  const icon = launcherIconFor(to);
  if (icon.id === from.id) return null;
  return {
    icon,
    warning: {
      title: text.title,
      message: launcher.dropsHomeScreenIcon ? text.dropsFromHomeScreen : text.message,
      action: { label: text.yes },
      alternativeLabel: text.no,
    },
  };
};

/** The synced colours alongside the launcher icon kept on this phone. */
export interface ThemeState {
  readonly choice: ThemeChoice;
  readonly icon: LauncherIcon;
}

/** Applies an explicit answer to the icon prompt. */
export const resolveThemeChange = (
  current: ThemeState,
  next: ThemeChoice,
  answer: AlertChoice,
): ThemeState =>
  answer === "dismiss"
    ? current
    : { choice: next, icon: answer === "action" ? launcherIconFor(next) : current.icon };

/** Whether Reset to defaults has nothing to do: the shipped colours and the shipped icon. */
export const isDefaultThemeState = ({ choice, icon }: ThemeState): boolean =>
  isDefaultThemeChoice(choice) && icon.id === launcherIconFor(DEFAULT_THEME_CHOICE).id;
