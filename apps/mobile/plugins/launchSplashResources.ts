// The Android resources behind the launch splash: the moving logo on every
// splash, and the splash themes Core picks (`LAUNCH_SPLASH_THEMES`), one style
// per choice in Settings › Theme. A style's ground and logo colours are colour
// resources with the light value in `values/` and the dark one in
// `values-night/`; the logo (`launchLogoDrawable.ts`) reads its colours from
// the style through two theme attributes. Pure, so the app tests can check it
// without prebuild.
import {
  DEFAULT_THEME_CHOICE,
  LAUNCH_LOGO,
  LAUNCH_SPLASH_THEMES,
  launchTheme,
  type LaunchColors,
  type ThemeChoice,
} from "@wave/core";

/** An Android resources file as Expo's config plugins parse it (xml2js). */
export interface ResourcesXml {
  readonly resources: {
    readonly style?: readonly ResourceStyle[];
    readonly color?: readonly ResourceValue[];
    readonly [kind: string]: unknown;
  };
}

interface ResourceValue {
  readonly $: { readonly name: string };
  readonly _: string;
}

interface ResourceStyle {
  readonly $: { readonly name: string; readonly parent?: string };
  readonly item?: readonly ResourceValue[];
}

/** The splash style expo-splash-screen writes: the manifest's, with the shipped theme. */
const SHIPPED_SPLASH = "Theme.App.SplashScreen";

/** The theme attributes the logo's waves take their colours from (`launch_logo_attrs.xml`). */
export const LAUNCH_LOGO_ATTRS = {
  primary: "waveLaunchPrimary",
  secondary: "waveLaunchSecondary",
} as const;

/** The animated logo every splash draws (`launchLogoDrawable.ts`). */
export const LAUNCH_LOGO_DRAWABLE = "launch_logo";

/** Colour resource names: grounds by background pair, inks by background pair and swatch. */
const colorNames = ({ light, dark, primary, secondary }: ThemeChoice) => ({
  background: `launch_background_${light}_${dark}`,
  primary: `launch_primary_${light}_${dark}_${primary}`,
  secondary: `launch_secondary_${light}_${dark}_${secondary}`,
});

/** The shipped splash's ink colours (its ground is expo-splash-screen's). */
const SHIPPED_COLORS = { primary: "launch_primary", secondary: "launch_secondary" } as const;

const value = (name: string, text: string): ResourceValue => ({ $: { name }, _: text });

/** Replaces the entries named like `added`, keeping everything else in place. */
const merge = <A extends { readonly $: { readonly name: string } }>(
  current: readonly A[] | undefined,
  added: readonly A[],
): A[] => {
  const names = new Set(added.map((entry) => entry.$.name));
  return [...(current ?? []).filter((entry) => !names.has(entry.$.name)), ...added];
};

/** The shipped splash, drawing the moving logo in the shipped theme's colours. */
const withMovingLogo = (style: ResourceStyle): ResourceStyle =>
  style.$.name !== SHIPPED_SPLASH
    ? style
    : {
        ...style,
        item: merge(style.item, [
          value("windowSplashScreenAnimatedIcon", `@drawable/${LAUNCH_LOGO_DRAWABLE}`),
          value("windowSplashScreenAnimationDuration", String(LAUNCH_LOGO.android12MotionMs)),
          value(LAUNCH_LOGO_ATTRS.primary, `@color/${SHIPPED_COLORS.primary}`),
          value(LAUNCH_LOGO_ATTRS.secondary, `@color/${SHIPPED_COLORS.secondary}`),
        ]),
      };

/**
 * Makes the shipped splash draw the moving logo and adds a style per splash
 * theme: the shipped splash on that choice's ground, its logo in that
 * choice's colours.
 */
export const addLaunchSplashStyles = (styles: ResourcesXml): ResourcesXml => ({
  ...styles,
  resources: {
    ...styles.resources,
    style: merge(
      styles.resources.style?.map(withMovingLogo),
      LAUNCH_SPLASH_THEMES.map((theme) => {
        const names = colorNames(theme.choice);
        return {
          $: { name: theme.name, parent: SHIPPED_SPLASH },
          item: [
            value("windowSplashScreenBackground", `@color/${names.background}`),
            value(LAUNCH_LOGO_ATTRS.primary, `@color/${names.primary}`),
            value(LAUNCH_LOGO_ATTRS.secondary, `@color/${names.secondary}`),
          ],
        };
      }),
    ),
  },
});

/** Each colour the splash styles name, for one mode (`values/` is light, `values-night/` dark). */
export const addLaunchSplashColors = (
  colors: ResourcesXml,
  scheme: "light" | "dark",
): ResourcesXml => {
  const added = new Map<string, string>();
  const shipped: LaunchColors = launchTheme(DEFAULT_THEME_CHOICE)[scheme];
  added.set(SHIPPED_COLORS.primary, shipped.primary);
  added.set(SHIPPED_COLORS.secondary, shipped.secondary);
  for (const theme of LAUNCH_SPLASH_THEMES) {
    const names = colorNames(theme.choice);
    for (const key of ["background", "primary", "secondary"] as const)
      added.set(names[key], theme[scheme][key]);
  }
  return {
    ...colors,
    resources: {
      ...colors.resources,
      color: merge(
        colors.resources.color,
        [...added].map(([name, text]) => value(name, text)),
      ),
    },
  };
};
