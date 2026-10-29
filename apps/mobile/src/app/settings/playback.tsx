import { useLocalisation } from "@/localisation/localisation";
import { useScreenContent } from "@/lib/screenTiming";
import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { ChoiceSection } from "@/settings/ChoiceRow";
import { CROSSFADE, setCrossfadeSeconds, useCrossfadeSeconds } from "@/settings/crossfade";
import { setDontPlayExplicit, useDontPlayExplicit } from "@/settings/dontPlayExplicit";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { streamBufferChoice } from "@/settings/streamBuffer";

/** Settings › Playback: how one song gives way to the next, which songs play, and how much streamed audio is loaded ahead. */
export default function PlaybackSettingsScreen() {
  const { strings } = useLocalisation();
  useScreenContent(true);
  const seconds = useCrossfadeSeconds();
  const skipExplicit = useDontPlayExplicit();
  const bufferMinutes = streamBufferChoice.setting.useValue();
  return (
    <SettingsPageScreen page="playback">
      <View>
        <Hairline />
        <SettingsSlider
          label={strings.settings.crossfade}
          value={seconds}
          range={CROSSFADE}
          format={(value) => (value === 0 ? strings.settings.off : `${value} s`)}
          onChange={setCrossfadeSeconds}
        />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {strings.settings.asASongEndsOnItsOwn}
        </Text>
      </View>
      <View>
        <Hairline />
        <SettingsSwitch
          label={strings.settings.dontPlayExplicit}
          value={skipExplicit}
          onValueChange={setDontPlayExplicit}
        />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {strings.settings.skipsSongsMarkedExplicitByYouTubeMusic}
        </Text>
      </View>
      <ChoiceSection
        choice={streamBufferChoice}
        current={bufferMinutes}
        note={strings.settings.howMuchOfAStreamedSongWave}
      />
    </SettingsPageScreen>
  );
}
