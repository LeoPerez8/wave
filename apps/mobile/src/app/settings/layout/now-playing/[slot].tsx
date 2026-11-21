import { readNowPlayingSlotRoute } from "@wave/core";
import { Redirect, useLocalSearchParams } from "expo-router";

import { useScreenContent } from "@/lib/screenTiming";
import { NowPlayingSlotPickerScreen } from "@/settings/NowPlayingSlots";

/**
 * Settings › Layout › Now Playing › Slot <n>: what that slot of Now Playing
 * holds. A link naming no slot (`1` to `5` for the footer's, `left` and
 * `right` for the transport's) opens the Now Playing page instead.
 */
export default function NowPlayingSlotSettingsScreen() {
  useScreenContent(true);
  const { slot } = useLocalSearchParams<{ slot: string }>();
  const index = readNowPlayingSlotRoute(slot);
  return index === null ? (
    <Redirect href="/settings/layout/now-playing" />
  ) : (
    <NowPlayingSlotPickerScreen slot={index} />
  );
}
