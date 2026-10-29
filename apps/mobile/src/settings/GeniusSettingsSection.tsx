import { useLocalisation } from "@/localisation/localisation";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";

import { setGeniusInsightsEnabled, useGeniusInsightsEnabled } from "./genius";

/** Settings › Lyrics and tags › Genius: the switch for every Genius request. */
export function GeniusSettingsSection() {
  const { strings } = useLocalisation();
  const enabled = useGeniusInsightsEnabled();

  return (
    <View>
      <CatalogLine className="mb-2">Genius</CatalogLine>
      <Hairline />
      <SettingsSwitch
        label={strings.settings.geniusInsights}
        value={enabled}
        onValueChange={setGeniusInsightsEnabled}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.openingLyricsOnASongWithLyrics}
      </Text>
    </View>
  );
}
