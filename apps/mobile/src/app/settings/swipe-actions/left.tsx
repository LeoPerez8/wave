import { useScreenContent } from "@/lib/screenTiming";
import { SwipeChoicePickerScreen } from "@/settings/SwipeDirections";

/** Settings › Swipe actions › Swipe left: what swiping a song row left runs. */
export default function SwipeLeftSettingsScreen() {
  useScreenContent(true);
  return <SwipeChoicePickerScreen side="left" />;
}
