import { PermissionsAndroid, Platform } from "react-native";

let asked = false;

/**
 * Android 13+ hides a foreground service's progress notification (downloads,
 * the lyrics and genre run, link imports) unless Wave may post notifications:
 * asks once per session, as the first of them starts. The work goes on either way.
 */
export const askForNotifications = (): void => {
  if (asked || Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  asked = true;
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(
    () => undefined,
  );
};
