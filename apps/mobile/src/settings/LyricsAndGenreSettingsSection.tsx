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
 * Settings › Lyrics and genre: allowing lookups online, and finding lyrics and
 * genre for the whole Library in the background, with progress and Cancel.
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
          Find lyrics and genre online
        </Text>
        <Switch
          accessibilityLabel="Find lyrics and genre online"
          value={enabled}
          onValueChange={setLookups}
          trackColor={{ false: fill, true: accent }}
          thumbColor={surface}
        />
      </View>
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Find Lyrics and Genre, in a song&apos;s menu, looks up its lyrics on LRCLIB and its
        album&apos;s genre on Deezer, which means sending them its title, artist, album and length,
        and writes what it finds into the file, replacing the lyrics and genre there. Off, Wave
        makes no lookups.
      </Text>
      {run.status === "running" ? (
        <View className="mt-4 flex-row items-center">
          <Text
            accessibilityLiveRegion="polite"
            className="flex-1 font-sans text-footnote text-secondary"
          >
            {run.total === 0
              ? "Finding lyrics and genre…"
              : `Finding lyrics and genre… ${run.done.toLocaleString("en")} of ${run.total.toLocaleString("en")}`}
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
    </>
  );
}
