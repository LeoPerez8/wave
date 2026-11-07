import { PermissionsAndroid, Platform } from "react-native";
import { persistedSetting } from "@/lib/persistedSetting";
import { WaveNative } from "@/native/waveNative";
import { waveAccountAvailable } from "@/settings/waveAccount";
import { useWaveSignedIn } from "@/sync/waveSignedIn";

/**
 * Whether this build can check shows at all: it asks Ticketmaster through
 * the sync service's routes with the Wave account's session, so a build with
 * no service (made before it was set up) never can.
 */
export const showsConfigured = waveAccountAvailable;

/**
 * Whether shows can be followed now: `"available"` while a Wave account is
 * signed in, `"signIn"` when signing in would make them so, and `"none"` on a
 * build with no sync service or until the session is known.
 */
export const useShowsAvailability = (): "available" | "signIn" | "none" => {
  const signedIn = useWaveSignedIn();
  if (!showsConfigured || signedIn === null) return "none";
  return signedIn ? "available" : "signIn";
};
const asked = persistedSetting<boolean>({
  key: "settings.showNotificationsAsked",
  read: (s) => s === "yes",
  write: (s) => (s ? "yes" : null),
});
export const showsNotificationsEnabled = () => WaveNative.showNotificationsEnabled?.() ?? false;
export const askShowNotifications = async () => {
  if (asked.get()) return;
  asked.set(true);
  if (Platform.OS === "android" && Number(Platform.Version) >= 33)
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
};
