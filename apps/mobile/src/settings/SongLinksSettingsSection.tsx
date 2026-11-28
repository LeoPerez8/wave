import { useLocalisation } from "@/localisation/localisation";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { WaveNative } from "@/native/waveNative";
import { setOfferCopiedLinks, useOfferCopiedLinksSetting } from "./offerCopiedLinks";
import { openAppLinkSettings, useSongLinkSetup } from "./songLinkHandling";

/**
 * Settings › Accounts › Song links: whether a song or playlist link tapped in
 * another app opens Wave (all, some or none of its hosts), a row per app that
 * still opens its own links, which opens that app's Open by default page, and
 * the row that opens Android's Open by default page for Wave; then Offer copied links, whether
 * coming back to Wave with a song link copied offers to open it.
 */
export function SongLinksSettingsSection() {
  const { strings } = useLocalisation();
  const setup = useSongLinkSetup();
  if (setup === null) return null;
  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.songLinks}</CatalogLine>
      <Hairline />
      {setup.turnOff.map((step) => (
        <EntryRow
          key={step.service}
          label={step.button}
          line={step.step}
          lineShown
          onPress={() => openAppLinkSettings(step.packageName)}
        />
      ))}
      <EntryRow
        label={strings.settings.openSongLinksInWave}
        onPress={() => void WaveNative.openLinkSettings?.()}
      />
      <Text className="mt-2 font-sans text-footnote text-secondary">{setup.line}</Text>
      <OfferCopiedLinks />
    </View>
  );
}

/** Offer copied links, with the line under it; not on an APK built before the clip's description read. */
function OfferCopiedLinks() {
  const { strings } = useLocalisation();
  const on = useOfferCopiedLinksSetting();
  if (WaveNative.readClipHint === undefined) return null;
  return (
    <View className="mt-4">
      <Hairline />
      <SettingsSwitch
        label={strings.settings.offerCopiedLinks}
        value={on}
        onValueChange={setOfferCopiedLinks}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.offerCopiedLinksLine}
      </Text>
    </View>
  );
}
