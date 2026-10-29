import { libraryLookupProgress } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";
import { cancelFixSongs, startLibraryLookup, useFixSongsRun } from "@/library/findLyricsAndGenre";

import { setLyricsAndGenreLookupsEnabled, useLyricsAndGenreLookupsEnabled } from "./lyricsAndGenre";

const setLookups = (on: boolean): void => {
  setLyricsAndGenreLookupsEnabled(on);
  // Off means no more requests, including the Fix Songs run's.
  if (!on) cancelFixSongs();
};

/**
 * Settings › Lyrics and genre: allowing Fix Song's lookups online, and Fix
 * Songs on the whole Library in the background, with progress and Cancel
 * (also in the run's notification, and for a run started before Wave was reopened).
 */
export function LyricsAndGenreSettingsSection() {
  const { strings } = useLocalisation();
  const enabled = useLyricsAndGenreLookupsEnabled();
  const run = useFixSongsRun();

  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.lyricsAndGenre}</CatalogLine>
      <Hairline />
      <SettingsSwitch
        label={strings.settings.fixSongsOnline}
        value={enabled}
        onValueChange={setLookups}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.fixSongInTheMenuOfA}
      </Text>
      {run.status === "running" ? (
        <View className="mt-4 flex-row items-center">
          <Text
            accessibilityLiveRegion="polite"
            className="flex-1 font-sans text-footnote text-secondary"
          >
            {libraryLookupProgress(run.done, run.total, strings).line}
          </Text>
          <TextButton label={strings.settings.cancel} onPress={cancelFixSongs} />
        </View>
      ) : (
        <View className="mt-4 items-start">
          <TextButton
            label={strings.settings.fixSongsInTheWholeLibrary}
            disabled={!enabled}
            onPress={() => void startLibraryLookup()}
          />
        </View>
      )}
    </View>
  );
}
