import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";
import { CROSSFADE, setCrossfadeSeconds, useCrossfadeSeconds } from "@/settings/crossfade";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Playback: how one song gives way to the next. */
export default function PlaybackSettingsScreen() {
  const seconds = useCrossfadeSeconds();
  return (
    <SettingsPageScreen page="playback">
      <View>
        <Hairline />
        <SettingsSlider
          label="Crossfade"
          value={seconds}
          range={CROSSFADE}
          format={(value) => (value === 0 ? "Off" : `${value} s`)}
          onChange={setCrossfadeSeconds}
        />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          As a song ends on its own, the next one fades in over it for this long. Skipping or
          picking a song switches at once. Off plays songs back to back, without a gap.
        </Text>
      </View>
    </SettingsPageScreen>
  );
}
