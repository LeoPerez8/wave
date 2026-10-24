// The Android resources behind the launch splash: the moving logo on every
// splash, and the splash themes Core picks (`LAUNCH_SPLASH_THEMES`), one style
// per background pair and palette ink pair. Its ground and logo colours use
// resources with the light value in `values/` and the dark one in
// `values-night/`; the logo (`launchLogoDrawable.ts`) reads its colours from
// the style through two theme attributes. Pure, so the app tests can check it
// without prebuild.
import {
  DEFAULT_THEME_CHOICE,
  LAUNCH_LOGO,
  LAUNCH_SPLASH_THEMES,
  launchTheme,
  type LaunchTheme,
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

type SplashTones = Pick<LaunchTheme, "light" | "dark">;
const COLOR_KEYS = ["background", "primary", "secondary"] as const;

/** One short resource name for each distinct pair of mode tones, shared by both waves. */
const splashPalette = (themes: readonly SplashTones[]) => {
  const colors = new Map<string, { name: string; light: string; dark: string }>();
  for (const theme of themes) {
    for (const key of COLOR_KEYS) {
      const light = theme.light[key];
      const dark = theme.dark[key];
      const pair = `${light}/${dark}`;
      if (!colors.has(pair))
        colors.set(pair, { name: `wlc${colors.size.toString(36)}`, light, dark });
    }
  }
  return [...colors.values()];
};

const SPLASH_COLORS = splashPalette([launchTheme(DEFAULT_THEME_CHOICE), ...LAUNCH_SPLASH_THEMES]);
const COLOR_NAMES = new Map(
  SPLASH_COLORS.map(({ name, light, dark }) => [`${light}/${dark}`, name]),
);

/** Looks up names without changing the palette, regardless of which resource mod runs first. */
const colorNames = (theme: SplashTones) => {
  const name = (key: (typeof COLOR_KEYS)[number]): string =>
    COLOR_NAMES.get(`${theme.light[key]}/${theme.dark[key]}`)!;
  return { background: name("background"), primary: name("primary"), secondary: name("secondary") };
};

const SHIPPED_COLORS = colorNames(launchTheme(DEFAULT_THEME_CHOICE));

const value = (name: string, text: string): ResourceValue => ({ $: { name }, _: text });

const splashStyles: readonly ResourceStyle[] = LAUNCH_SPLASH_THEMES.map((theme) => {
  const names = colorNames(theme);
  return {
    $: { name: theme.name, parent: SHIPPED_SPLASH },
    item: [
      value("windowSplashScreenBackground", `@color/${names.background}`),
      value(LAUNCH_LOGO_ATTRS.primary, `@color/${names.primary}`),
      value(LAUNCH_LOGO_ATTRS.secondary, `@color/${names.secondary}`),
    ],
  };
});

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
    style: merge(styles.resources.style?.map(withMovingLogo), splashStyles),
  },
});

/** Each colour the splash styles name, for one mode (`values/` is light, `values-night/` dark). */
export const addLaunchSplashColors = (
  colors: ResourcesXml,
  scheme: "light" | "dark",
): ResourcesXml => {
  return {
    ...colors,
    resources: {
      ...colors.resources,
      color: merge(
        colors.resources.color,
        SPLASH_COLORS.map((color) => value(color.name, color[scheme])),
      ),
    },
  };
};
