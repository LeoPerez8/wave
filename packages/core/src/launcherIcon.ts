/**
 * The launcher icon: two waves on black, the top one in the chosen primary and
 * the bottom one in the chosen secondary. Android can't recolour a launcher
 * icon at runtime, so Wave ships one icon per primary × secondary and switches
 * between them.
 */

import type { AlertSpec } from "./alert.ts";
import { LOGO_WAVES, logoIconPaths, logoWaveY } from "./logo.ts";
import { THEME_SWATCHES, type InkSwatch, type ThemeChoice } from "./themeChoice.ts";

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

/**
 * The shipped teal and amber of the icon (#94), brighter than the dark theme's
 * accent and highlight. Other swatches take their dark-scheme tone, which is
 * made to read on dark grounds.
 */
const SHIPPED_ICON_INK: Readonly<Record<string, string>> = {
  teal: "#14b7a6",
  ember: "#f5b83d",
};

const iconInk = (swatch: InkSwatch): string => SHIPPED_ICON_INK[swatch.id] ?? swatch.dark;

/** Every icon Wave ships, primary-major; the first is the shipped one. */
export const LAUNCHER_ICONS: readonly LauncherIcon[] = THEME_SWATCHES.primary.flatMap((primary) =>
  THEME_SWATCHES.secondary.map((secondary) => ({
    id: `${primary.id}_${secondary.id}`,
    primary: primary.id,
    secondary: secondary.id,
    top: iconInk(primary),
    bottom: iconInk(secondary),
  })),
);

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

/** The icon a theme choice shows; an unknown swatch counts as its group's default. */
export const launcherIconFor = (choice: ThemeChoice): LauncherIcon =>
  LAUNCHER_ICONS.find(
    (icon) => icon.primary === choice.primary && icon.secondary === choice.secondary,
  ) ?? LAUNCHER_ICONS[0]!;

/** What the launcher does when Wave switches icons. */
export interface LauncherBehaviour {
  /** It removes Wave's icon from the home screen (the app drawer gets the new one). */
  readonly dropsHomeScreenIcon: boolean;
}

/** A theme change that switches the launcher icon. */
export interface LauncherIconSwitch {
  readonly icon: LauncherIcon;
  /** Asked before the colours change, when the switch costs the home-screen icon. */
  readonly warning: (AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> }) | null;
}

/** Whether going from one theme choice to another switches the icon, and what to say first. */
export const launcherIconSwitch = (
  from: ThemeChoice,
  to: ThemeChoice,
  launcher: LauncherBehaviour,
): LauncherIconSwitch | null => {
  const icon = launcherIconFor(to);
  if (icon.id === launcherIconFor(from).id) return null;
  return {
    icon,
    warning: launcher.dropsHomeScreenIcon
      ? {
          title: "Change the app icon?",
          message:
            "Wave's icon takes these colours when you leave the app, and your launcher removes it from the home screen when it changes. Add it back from the app drawer.",
          action: { label: "Change" },
        }
      : null,
  };
};
