import { useScreenContent } from "@/lib/screenTiming";
import { shuffleKindChoice } from "@/nowPlaying/ShuffleMenu";
import { ChoiceSection } from "@/settings/ChoiceRow";
import { NowPlayingSlotsSection } from "@/settings/NowPlayingSlots";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { useShuffleKind } from "@/settings/shuffleKind";

/**
 * Settings › Layout › Now Playing: the four button slots left of Queue, each
 * opening its picker (`now-playing/<n>`), with Reset to Default; then the
 * kind of shuffle, the same preference the shuffle card sets. Each change is
 * saved as it's made.
 */
export default function NowPlayingLayoutSettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsPageScreen layoutPage="nowPlaying">
      <NowPlayingSlotsSection />
      <ChoiceSection
        choice={shuffleKindChoice}
        current={useShuffleKind()}
        note="Every shuffle uses it. A long press on a shuffle button picks it too."
      />
    </SettingsPageScreen>
  );
}
