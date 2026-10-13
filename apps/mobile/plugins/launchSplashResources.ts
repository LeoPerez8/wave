// The Android resources behind the launch splash themes Core picks
// (`LAUNCH_SPLASH_THEMES`): one style per pair of backgrounds, whose ground is
// a colour resource with the light background in `values/` and the dark one in
// `values-night/`. Pure, so the app tests can check it without prebuild.
import { LAUNCH_SPLASH_THEMES, type LaunchSplashTheme } from "@wave/core";

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

/** The splash style expo-splash-screen writes: logo, behaviour and hand-over to the app theme. */
const SHIPPED_SPLASH = "Theme.App.SplashScreen";

/** `Theme.Wave.Launch.sand.navy` → `launch_background_sand_navy`. */
const colorName = (theme: LaunchSplashTheme): string =>
  `launch_background_${theme.name.split(".").slice(3).join("_").toLowerCase()}`;

/** Replaces the entries named like `added`, keeping everything else in place. */
const merge = <A extends { readonly $: { readonly name: string } }>(
  current: readonly A[] | undefined,
  added: readonly A[],
): A[] => {
  const names = new Set(added.map((entry) => entry.$.name));
  return [...(current ?? []).filter((entry) => !names.has(entry.$.name)), ...added];
};

/** Adds a style per splash theme: the shipped splash on that theme's ground. */
export const addLaunchSplashStyles = (styles: ResourcesXml): ResourcesXml => ({
  ...styles,
  resources: {
    ...styles.resources,
    style: merge(
      styles.resources.style,
      LAUNCH_SPLASH_THEMES.map((theme) => ({
        $: { name: theme.name, parent: SHIPPED_SPLASH },
        item: [{ $: { name: "windowSplashScreenBackground" }, _: `@color/${colorName(theme)}` }],
      })),
    ),
  },
});

/** Adds each splash theme's ground for one mode (`values/` is light, `values-night/` dark). */
export const addLaunchSplashColors = (
  colors: ResourcesXml,
  scheme: "light" | "dark",
): ResourcesXml => ({
  ...colors,
  resources: {
    ...colors.resources,
    color: merge(
      colors.resources.color,
      LAUNCH_SPLASH_THEMES.map((theme) => ({ $: { name: colorName(theme) }, _: theme[scheme] })),
    ),
  },
});
