import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";

import { setGeniusInsightsEnabled, useGeniusInsightsEnabled } from "./genius";

/** Settings › Lyrics and tags › Genius: the switch for every Genius request. */
export function GeniusSettingsSection() {
  const enabled = useGeniusInsightsEnabled();

  return (
    <View>
      <CatalogLine className="mb-2">Genius</CatalogLine>
      <Hairline />
      <SettingsSwitch
        label="Genius insights"
        value={enabled}
        onValueChange={setGeniusInsightsEnabled}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Opening Lyrics on a song with lyrics shows what Genius says about it above the lyrics, which
        means sending Genius the song&apos;s title and artist. Off, Wave makes no requests to
        Genius.
      </Text>
    </View>
  );
}
