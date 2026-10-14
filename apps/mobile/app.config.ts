import type { ExpoConfig } from "expo/config";

import { versionCode } from "./plugins/appVersion.ts";
import { withLauncherIcons } from "./plugins/withLauncherIcons.ts";
import { withLaunchSplash } from "./plugins/withLaunchSplash.ts";

// Font files ship inside the @expo-google-fonts/inter package and are embedded
// natively at prebuild time, so text renders in Inter from the first frame.
const inter = (file: string): string => `./node_modules/@expo-google-fonts/inter/${file}`;

// Wave's version, kept here and nowhere else: Android's versionCode follows from it, and
// pushing the tag v<version> publishes the release (docs/spec.md, Releases).
const version = "0.5.0";

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
    predictiveBackGestureEnabled: true,
    // All-files access lets the scanner read every audio file in the scan roots.
    // Acceptable because Wave is sideloaded, not distributed on the Play Store.
    permissions: ["android.permission.MANAGE_EXTERNAL_STORAGE"],
    // Lists Wave in the share sheet for shared text and links, and only those: a playlist
    // link shared from YT Music or a browser opens its import card (docs/spec.md).
    intentFilters: [{ action: "SEND", category: ["DEFAULT"], data: [{ mimeType: "text/plain" }] }],
  },
  experiments: {
    typedRoutes: true,
  },
  plugins: [
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
// (Expo runs mods in reverse order) and can edit that splash's style.
export default withLaunchSplash(withLauncherIcons(config));
