import { CROSSFADE } from "@wave/core";
import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";
import { setCrossfadeSeconds, useCrossfadeSeconds } from "@/settings/crossfade";
import { SettingsPageScreen } from "@/settings/SettingsPage";

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
          format={(value) => value === 0 ? "Off" : `${value} s`}
          onChange={setCrossfadeSeconds}
        />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          Overlap songs as they finish. Off keeps gapless playback. Skips switch immediately.
        </Text>
      </View>
    </SettingsPageScreen>
  );
}
