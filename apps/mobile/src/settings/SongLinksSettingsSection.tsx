import { songLinkHandlingLine, type SongLinkHandling } from "@wave/core";
import { useLocalisation } from "@/localisation/localisation";
import { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { WaveNative } from "@/native/waveNative";
import { readSongLinkHandling } from "./songLinkHandling";

/**
 * Read on mount and again whenever Wave comes back to the foreground: only
 * Android's Open by default page, another activity, changes it, and the screen
 * never loses focus to it.
 */
const useSongLinkHandling = (): SongLinkHandling | null => {
  const [handling, setHandling] = useState(readSongLinkHandling);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") setHandling(readSongLinkHandling());
    });
    return () => subscription.remove();
  }, []);
  return handling;
};

/**
 * Settings › Accounts › Song links: whether a song or playlist link tapped in
 * another app opens Wave (all, some or none of its hosts), and the row that
 * opens Android's Open by default page for Wave.
 */
export function SongLinksSettingsSection() {
  const { strings, language } = useLocalisation();
  const handling = useSongLinkHandling();
  if (handling === null) return null;
  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.songLinks}</CatalogLine>
      <Hairline />
      <EntryRow
        label={strings.settings.openSongLinksInWave}
        onPress={() => void WaveNative.openLinkSettings?.()}
      />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {songLinkHandlingLine(handling, language)}
      </Text>
    </View>
  );
}
