import type { ExpoConfig } from "expo/config";

import packageJson from "./package.json" with { type: "json" };

import { versionCode } from "./plugins/appVersion.ts";
import { withAppLanguages } from "./plugins/withAppLanguages.ts";
import { withArtProfiles } from "./plugins/withArtProfiles.ts";
import { withGradleBuildCache } from "./plugins/withGradleBuildCache.ts";
import { withHermesFlags } from "./plugins/withHermesFlags.ts";
import { withLauncherIcons } from "./plugins/withLauncherIcons.ts";
import { withLaunchSplash } from "./plugins/withLaunchSplash.ts";
import { withShareShortcut } from "./plugins/withShareShortcut.ts";

// Font files ship inside the @expo-google-fonts/inter package and are embedded
// natively at prebuild time, so text renders in Inter from the first frame.
const inter = (file: string): string => `./node_modules/@expo-google-fonts/inter/${file}`;

// Wave's version lives in package.json's `version` and nowhere else: Android's versionCode
// follows from it. CI writes the next one there on every push to main or ti that changes the
// app (ti's end in -ti) and releases it (docs/spec.md, Releases).
const { version } = packageJson;

const config: ExpoConfig = {
  name: "Wave",
  slug: "wave",
  scheme: "wave",
  version,
  platforms: ["android"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  android: {
    package: "dev.leoperez.wave",
    versionCode: versionCode(version),
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon-foreground.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
      backgroundColor: "#000000",
    },
    // Keep Android 13+ Back on React Native's hardwareBackPress path, so
    // sheets and the root exit confirmation can consume it before the activity leaves.
    predictiveBackGestureEnabled: false,
    // All-files access lets the scanner read every audio file in the scan roots.
    // Acceptable because Wave is sideloaded, not distributed on the Play Store.
    permissions: ["android.permission.MANAGE_EXTERNAL_STORAGE"],
    // Lists Wave in the share sheet for shared text and links, and only those: a playlist
    // link shared from YT Music or a browser opens its import card (docs/spec.md). The
    // "Import to Wave" sharing shortcut (withShareShortcut) sends its shares here too.
    intentFilters: [{ action: "SEND", category: ["DEFAULT"], data: [{ mimeType: "text/plain" }] }],
  },
  experiments: {
    typedRoutes: true,
    // React Compiler stays off until a phone run shows it helps (docs/performance/
    // 728-react-compiler.md). `EXPO_PUBLIC_WAVE_REACT_COMPILER=1` at bundle time builds the
    // comparison; the bundle inlines it too, so a perf build reports it.
    ...(process.env.EXPO_PUBLIC_WAVE_REACT_COMPILER === "1" && { reactCompiler: true }),
  },
  // The Wave account (docs/spec.md, "Wave account and sync"): the sync service's URL and Wave's
  // web OAuth client id, the audience of the Google ID tokens it accepts. Neither is a secret.
  // Empty, Settings says the account isn't set up on this build.
  extra: {
    syncUrl: "https://wave-sync.leonardolp2424.workers.dev",
    googleWebClientId: "334515982590-tq2ks7u11rt4708ifaotkumjfakgodk8.apps.googleusercontent.com",
    // The Facebook App ID Instagram's Stories intent requires as its source application (a Meta
    // app's id from developers.facebook.com; not a secret). Empty, the lyrics card has no
    // Instagram Stories destination (docs/spec.md, "Sharing lyrics").
    facebookAppId: "944759748411173",
  },
  // Over-the-air updates (docs/spec.md, Build and CI). These are placeholders: every APK's
  // generated project starts the same, off, so its key (scripts/ci/repack.ts) doesn't depend on
  // the channel, and a local build never updates. CI then stamps the run's channel and runtime
  // version, the key itself, into the manifest (scripts/ci/update-config.ts).
  runtimeVersion: "unstamped",
  updates: {
    enabled: false,
    url: "https://wave-updates.leonardolp2424.workers.dev/v1/manifest",
    // Core's update policy decides when to check (apps/mobile/src/updates).
    checkAutomatically: "NEVER",
    fallbackToCacheTimeout: 0,
    requestHeaders: { "expo-channel-name": "none" },
  },
  plugins: [
    "expo-updates",
    "expo-router",
    "expo-status-bar",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon-light.png",
        imageWidth: 160,
        backgroundColor: "#E0ECEF",
        dark: {
          image: "./assets/splash-icon.png",
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-font",
      {
        android: {
          fonts: [
            {
              fontFamily: "Inter",
              fontDefinitions: [
                { path: inter("300Light/Inter_300Light.ttf"), weight: 300 },
                { path: inter("400Regular/Inter_400Regular.ttf"), weight: 400 },
                { path: inter("500Medium/Inter_500Medium.ttf"), weight: 500 },
                { path: inter("600SemiBold/Inter_600SemiBold.ttf"), weight: 600 },
                { path: inter("700Bold/Inter_700Bold.ttf"), weight: 700 },
                { path: inter("800ExtraBold/Inter_800ExtraBold.ttf"), weight: 800 },
              ],
            },
          ],
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          // Android 12 is the floor (native RenderEffect is available should any blur be added).
          minSdkVersion: 31,
          // innertubex (YT Music) is built with Kotlin 2.4; an older compiler can't read it.
          kotlinVersion: "2.4.20",
        },
      },
    ],
  ],
};

// The moving logo on the launch splash and a splash for each choice Settings › Theme offers
// (Android 13+), and one launcher icon per primary × secondary, switched from Settings › Theme.
// Applied here, before the plugin list, so the splash's changes run after expo-splash-screen's
// (Expo runs mods in reverse order) and can edit that splash's style. The sharing shortcut's
// share target comes first so it runs last, once the launcher icons' aliases exist.
// Gradle reuses cached outputs (#185), and Hermes skips the unused source map (#187).
// The APK ships Wave's own ART profiles from profiles/ (#317).
export default withAppLanguages(
  withArtProfiles(
    withHermesFlags(
      withGradleBuildCache(withLaunchSplash(withLauncherIcons(withShareShortcut(config)))),
    ),
  ),
);
