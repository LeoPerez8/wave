// The app log starts before anything else, so it sees everything that follows (src/log/appLog.ts).
// oxlint-disable-next-line import/no-unassigned-import
import "./src/log/startAppLog";
// The app entry: Expo Router's root component (the `main` surface the Activity renders)…
import "expo-router/entry";

import { AppRegistry } from "react-native";

import { startServices } from "./src/services";

/**
 * …and `WaveService`, the headless task the media library service holds while
 * Android Auto is connected (modules/wave-native, `JsRuntime`). It starts the
 * app services when Auto starts Wave without the Activity, and stays pending
 * so React Native keeps JS timers running; native finishes the task when Auto
 * disconnects.
 */
AppRegistry.registerHeadlessTask("WaveService", () => async () => {
  startServices("headless");
  await new Promise<never>(() => {});
});
