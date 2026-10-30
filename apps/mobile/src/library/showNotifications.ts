import { PermissionsAndroid, Platform } from "react-native";
import { persistedSetting } from "@/lib/persistedSetting";
import { WaveNative } from "@/native/waveNative";
export const ticketmasterKey = process.env.EXPO_PUBLIC_TICKETMASTER_API_KEY?.trim() ?? "";
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
