import { PermissionsAndroid } from "react-native";

const RECORD_AUDIO = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;

/** Whether Wave may use the microphone now, without asking. */
export const hasMicrophone = (): Promise<boolean> =>
  PermissionsAndroid.check(RECORD_AUDIO).catch(() => false);

/**
 * Whether Wave may use the microphone, asking Android the first time (and again
 * after a plain denial; after "Don't allow" twice Android answers denied at once).
 */
export const microphonePermission = async (): Promise<"granted" | "denied"> => {
  if (await hasMicrophone()) return "granted";
  const answer = await PermissionsAndroid.request(RECORD_AUDIO).catch(() => null);
  return answer === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied";
};
