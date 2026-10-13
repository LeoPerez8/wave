import type { ExpoConfig } from "expo/config";

// Font files ship inside the @expo-google-fonts/inter package and are embedded
// natively at prebuild time, so text renders in Inter from the first frame.
const inter = (file: string): string => `./node_modules/@expo-google-fonts/inter/${file}`;

const config: ExpoConfig = {
  name: "Wave",
  slug: "wave",
  scheme: "wave",
  version: "0.1.0",
  platforms: ["android"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  android: {
    package: "dev.leoperez.wave",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon-foreground.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
      backgroundColor: "#000000",
    },
    predictiveBackGestureEnabled: true,
    // All-files access lets the scanner read every audio file in the scan roots.
    // Acceptable because Wave is sideloaded, not distributed on the Play Store.
    permissions: ["android.permission.MANAGE_EXTERNAL_STORAGE"],
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
          backgroundColor: "#0A1113",
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
        },
      },
    ],
  ],
};

export default config;
