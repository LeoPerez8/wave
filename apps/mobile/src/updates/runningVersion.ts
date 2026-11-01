import Constants from "expo-constants";

/**
 * The version of the JS running now, which can be newer than the APK's versionName: under an update
 * this is the config it was published with, and otherwise the APK's embedded one, which a repack
 * rewrites. A JS reload reads it afresh.
 */
export const RUNNING_VERSION: string | null = Constants.expoConfig?.version ?? null;
