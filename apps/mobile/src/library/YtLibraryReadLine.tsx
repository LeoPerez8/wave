import { ytLibraryReadView } from "@wave/core";
import { Text, View } from "react-native";

import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { readYtLibraryPlaylistAgain, useReadingAgain, useYtLibraryBatch } from "./ytLibraryImport";

/**
 * The playlist page's line for a playlist From YT Music couldn't read (Core's
 * `ytLibraryReadView`): "Couldn't read it online", with Try
 * Again while YT Music is on, which reads "Reading…", not tappable, until
 * the read ends.
 */
export function YtLibraryReadLine({ playlistId }: { playlistId: number }) {
  const { language, strings } = useLocalisation();
  const view = ytLibraryReadView(useYtLibraryBatch(), playlistId, language);
  const ytMusic = useYtMusicEnabled();
  const trying = useReadingAgain(playlistId);
  if (view === null) return null;
  return (
    <View>
      <Text accessibilityLiveRegion="polite" className="font-sans text-footnote text-accent">
        {view.line}
      </Text>
      {ytMusic && (
        <View className="flex-row items-center">
          <TextButton
            label={trying ? strings.imports.reading : strings.imports.tryAgain}
            disabled={trying}
            onPress={() => void readYtLibraryPlaylistAgain(playlistId)}
          />
        </View>
      )}
    </View>
  );
}
