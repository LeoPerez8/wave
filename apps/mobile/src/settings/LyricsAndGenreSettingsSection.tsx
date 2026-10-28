import { libraryLookupProgress } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { TextButton } from "@/components/TextButton";
import { cancelFixSongs, startLibraryLookup, useFixSongsRun } from "@/library/findLyricsAndGenre";

import { setLyricsAndGenreLookupsEnabled, useLyricsAndGenreLookupsEnabled } from "./lyricsAndGenre";

/** The lookups switch, as shown and as read out. */
const LOOKUPS_LABEL = "Fix songs online";

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
  const enabled = useLyricsAndGenreLookupsEnabled();
  const run = useFixSongsRun();

  return (
    <View>
      <CatalogLine className="mb-2">Lyrics and genre</CatalogLine>
      <Hairline />
      <SettingsSwitch label={LOOKUPS_LABEL} value={enabled} onValueChange={setLookups} />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Fix Song, in the menu of a song missing lyrics, a genre, a year, a track number or an
        explicit flag, looks up only what it lacks: its lyrics on LRCLIB, and its album&apos;s
        genre, year and track number and whether it&apos;s explicit on Deezer, which means sending
        them its title, artist, album and length. It writes what it finds into the file and never
        replaces what&apos;s there. Off, Wave makes no lookups.
      </Text>
      {run.status === "running" ? (
        <View className="mt-4 flex-row items-center">
          <Text
            accessibilityLiveRegion="polite"
            className="flex-1 font-sans text-footnote text-secondary"
          >
            {libraryLookupProgress(run.done, run.total).line}
          </Text>
          <TextButton label="Cancel" onPress={cancelFixSongs} />
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
    </View>
  );
}
