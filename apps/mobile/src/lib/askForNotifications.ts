import { PermissionsAndroid, Platform } from "react-native";

let asked = false;

/**
 * Android 13+ needs notification permission to keep paused-playback controls and
 * show progress for downloads, the lyrics and genre run, and link imports.
 * Asks once per session when playback or work first starts; neither waits for an answer.
 */
export const askForNotifications = (): void => {
  if (asked || Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  asked = true;
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(
    () => undefined,
  );
};
