import { View } from "react-native";

import { SongRow } from "@/songs/SongRow";
import { songRowPresentation } from "@/songs/songListModel";

/** The fixed fake song: plain artwork, no file and no Library id, so it never touches the Library. */
const SAMPLE = songRowPresentation(
  { kind: "history", id: "sample", title: "Sample song", artist: "Wave", durationMs: 200_000 },
  {},
  "sample",
);

const nothing = (): void => undefined;

/**
 * Settings' sample song row: a fixed fake song ("Sample song", plain
 * artwork) drawn as a song row is, for the Motion and Touch samples to try
 * gestures on. Tapping it plays nothing. TalkBack reads it as one sample
 * ("Sample song row", then [accessibilityHint]), never as a song to play.
 */
export function SampleSongRow({ accessibilityHint }: { accessibilityHint: string }) {
  return (
    <View
      accessible
      accessibilityRole="none"
      accessibilityLabel="Sample song row"
      accessibilityHint={accessibilityHint}
    >
      <View importantForAccessibility="no-hide-descendants">
        <SongRow {...SAMPLE} onPress={nothing} />
      </View>
    </View>
  );
}
