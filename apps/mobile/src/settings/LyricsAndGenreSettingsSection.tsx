import { libraryLookupProgress } from "@wave/core";
import { Switch, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import {
  cancelLibraryLookup,
  startLibraryLookup,
  useLibraryLookup,
} from "@/library/findLyricsAndGenre";
import { useThemeColor } from "@/theme/useThemeColor";

import { setLyricsAndGenreLookupsEnabled, useLyricsAndGenreLookupsEnabled } from "./lyricsAndGenre";

const setLookups = (on: boolean): void => {
  setLyricsAndGenreLookupsEnabled(on);
  // Off means no more requests, including the Library-wide run's.
  if (!on) cancelLibraryLookup();
};

/**
 * Settings › Lyrics and genre: allowing Fix Song's lookups online, and Fix
 * Songs on the whole Library in the background, with progress and Cancel
 * (also in the run's notification, and for a run started before Wave was reopened).
 */
export function LyricsAndGenreSettingsSection() {
  const enabled = useLyricsAndGenreLookupsEnabled();
  const run = useLibraryLookup();
  const accent = useThemeColor("accent");
  const fill = useThemeColor("fill");
  const surface = useThemeColor("surface");

  return (
    <>
      <CatalogLine className="mb-2 mt-12">Lyrics and genre</CatalogLine>
      <Hairline />
      <View className="flex-row items-center" style={{ minHeight: grid.row }}>
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">
          Fix songs online
        </Text>
        <Switch
          accessibilityLabel="Fix songs online"
          value={enabled}
          onValueChange={setLookups}
          trackColor={{ false: fill, true: accent }}
          thumbColor={surface}
        />
      </View>
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Fix Song, in the menu of a song missing lyrics, a genre, a year or a track number, looks
        up only what it lacks: its lyrics on LRCLIB, and its album&apos;s genre, year and track
        number on Deezer, which means sending them its title, artist, album and length. It writes
        what it finds into the file and never replaces what&apos;s there. Off, Wave makes no
        lookups.
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
            label="Fix songs in the whole Library"
            disabled={!enabled}
            onPress={() => void startLibraryLookup()}
          />
        </View>
      )}
    </>
  );
}
