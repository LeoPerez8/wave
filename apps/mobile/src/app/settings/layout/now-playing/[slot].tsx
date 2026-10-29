import { useLocalSearchParams } from "expo-router";

import { useScreenContent } from "@/lib/screenTiming";
import { NowPlayingSlotPickerScreen } from "@/settings/NowPlayingSlots";

/** The slots' pickers' routes, `1` to `4`, left to right. */
const SLOTS = ["1", "2", "3", "4"];

/** Settings › Layout › Now Playing › Slot <n>: what that slot of Now Playing's row holds. */
export default function NowPlayingSlotSettingsScreen() {
  useScreenContent(true);
  const { slot } = useLocalSearchParams<{ slot: string }>();
  const index = SLOTS.indexOf(slot);
  return <NowPlayingSlotPickerScreen slot={index === -1 ? 0 : index} />;
}
