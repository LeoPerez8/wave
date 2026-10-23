import { useScreenContent } from "@/lib/screenTiming";
import { SwipeChoicePickerScreen } from "@/settings/SwipeDirections";

/** Settings › Swipe actions › Swipe right: what swiping a song row right runs. */
export default function SwipeRightSettingsScreen() {
  useScreenContent(true);
  return <SwipeChoicePickerScreen side="right" />;
}
