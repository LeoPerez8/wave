/**
 * The launcher icon: two waves on black, the top one in the chosen primary and
 * the bottom one in the chosen secondary. Android can't recolour a launcher
 * icon at runtime, so Wave ships one icon per primary × secondary and switches
 * between them.
 */

import type { AlertSpec } from "./alert.ts";
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

type Point = readonly [number, number];

/** A wave of the logo, in its own units (x runs -1..1), crest at `crestX`, shifted `dy` down. */
const logoWave = (crestX: number, dy: number): readonly Point[] => {
  const amplitude = 0.18;
  const period = 1.6;
  const steps = 240;
  return Array.from({ length: steps + 1 }, (_, i): Point => {
    const x = -1 + (2 * i) / steps;
    return [x, dy - amplitude * Math.cos((2 * Math.PI * (x - crestX)) / period)];
  });
};

/** Each wave's vertical offset from the logo's middle. */
const GAP = 0.25;

/**
 * Wave's logo: two rounded waves as polylines in the logo's own units (centred
 * on 0,0, x running -1..1), stroked `stroke` wide with round caps. The launcher
 * icons, splash logos and their PNGs (`apps/mobile/scripts/render-icons.ts`) all draw it.
 */
export const WAVE_LOGO: {
  readonly stroke: number;
  readonly top: readonly Point[];
  readonly bottom: readonly Point[];
  /** Furthest any stroke edge reaches from the centre. */
  readonly extent: number;
} = (() => {
  const stroke = 0.2;
  const top = logoWave(-0.6, -GAP);
  const bottom = logoWave(-0.76, GAP);
  const extent = Math.max(...[...top, ...bottom].map(([x, y]) => Math.hypot(x, y))) + stroke / 2;
  return { stroke, top, bottom, extent };
})();

/**
 * How far from the centre the logo reaches on a 108dp adaptive-icon layer, as a
 * fraction of its width. Every mask keeps at least the middle 66dp circle
 * (0.305 of the width), so 0.27 leaves a margin.
 */
export const LAUNCHER_ICON_RADIUS = 0.27;

/** Path data of a wave on a `viewport`-wide layer, every `stride`-th point (round joins hide the corners). */
const wavePath = (points: readonly Point[], viewport: number, scale: number, stride: number) =>
  points
    .filter((_, i) => i % stride === 0 || i === points.length - 1)
    .map(
      ([x, y], i) =>
        `${i === 0 ? "M" : "L"}${(viewport / 2 + x * scale).toFixed(2)} ${(viewport / 2 + y * scale).toFixed(2)}`,
    )
    .join(" ");

/**
 * The launcher icon's waves as vector paths on the adaptive icon's 108dp
 * foreground layer: each is stroked `strokeWidth` wide with round caps and
 * joins, in its icon's colour (or white for the monochrome themed icon).
 */
export const LAUNCHER_ICON_ART: {
  readonly viewport: 108;
  readonly strokeWidth: number;
  readonly top: string;
  readonly bottom: string;
} = (() => {
  const viewport = 108;
  const scale = (LAUNCHER_ICON_RADIUS * viewport) / WAVE_LOGO.extent;
  return {
    viewport,
    strokeWidth: Number((WAVE_LOGO.stroke * scale).toFixed(2)),
    top: wavePath(WAVE_LOGO.top, viewport, scale, 4),
    bottom: wavePath(WAVE_LOGO.bottom, viewport, scale, 4),
  };
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
