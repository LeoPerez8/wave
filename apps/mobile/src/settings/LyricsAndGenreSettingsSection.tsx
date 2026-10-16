import { libraryLookupProgress } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { TextButton } from "@/components/TextButton";
import {
  cancelLibraryLookup,
  startLibraryLookup,
  useLibraryLookup,
} from "@/library/findLyricsAndGenre";

import { setLyricsAndGenreLookupsEnabled, useLyricsAndGenreLookupsEnabled } from "./lyricsAndGenre";

const setLookups = (on: boolean): void => {
  setLyricsAndGenreLookupsEnabled(on);
  // Off means no more requests, including the Library-wide run's.
  if (!on) cancelLibraryLookup();
};

/**
 * Settings › Lyrics and genre: allowing lookups online, and finding lyrics and
 * genre for the whole Library in the background, with progress and Cancel
 * (also in the run's notification, and for a run started before Wave was reopened).
 */
export function LyricsAndGenreSettingsSection() {
  const enabled = useLyricsAndGenreLookupsEnabled();
  const run = useLibraryLookup();

  return (
    <View>
      <CatalogLine className="mb-2">Lyrics and genre</CatalogLine>
      <Hairline />
      <SettingsSwitch
        label="Find lyrics and genre online"
        value={enabled}
        onValueChange={setLookups}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Find Lyrics and Genre, in a song&apos;s menu, looks up its lyrics on LRCLIB and its
        album&apos;s genre, year and track number on Deezer, which means sending them its title,
        artist, album and length, and writes what it finds into the file, replacing the lyrics and
        genre there and filling in a missing track number or year. Off, Wave makes no lookups.
      </Text>
      {run.status === "running" ? (
        <View className="mt-4 flex-row items-center">
          <Text
            accessibilityLiveRegion="polite"
            className="flex-1 font-sans text-footnote text-secondary"
          >
            {libraryLookupProgress(run.done, run.total).line}
          </Text>
          <TextButton label="Cancel" onPress={cancelLibraryLookup} />
        </View>
      ) : (
        <View className="mt-4 items-start">
          <TextButton
            label="Find lyrics and genre for the whole Library"
            disabled={!enabled}
            onPress={() => void startLibraryLookup()}
          />
        </View>
      )}
    </View>
  );
}
