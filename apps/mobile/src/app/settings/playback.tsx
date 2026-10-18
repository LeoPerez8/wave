import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { CROSSFADE, setCrossfadeSeconds, useCrossfadeSeconds } from "@/settings/crossfade";
import { setDontPlayExplicit, useDontPlayExplicit } from "@/settings/dontPlayExplicit";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Playback: how one song gives way to the next, and which songs play. */
export default function PlaybackSettingsScreen() {
  const seconds = useCrossfadeSeconds();
  const skipExplicit = useDontPlayExplicit();
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
      <View>
        <Hairline />
        <SettingsSwitch
          label="Don't play explicit"
          value={skipExplicit}
          onValueChange={setDontPlayExplicit}
        />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          Skips songs marked explicit by YouTube Music or Deezer.
        </Text>
      </View>
    </SettingsPageScreen>
  );
}
