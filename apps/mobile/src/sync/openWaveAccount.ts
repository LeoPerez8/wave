import { router } from "expo-router";

import { closeNowPlaying } from "@/nowPlaying/sheet";

/**
 * Opens Settings › Accounts, where the Wave account signs in, once Now
 * Playing has slid away (at once when it isn't showing).
 */
export const openWaveAccount = (): void => closeNowPlaying(() => router.push("/settings/accounts"));
