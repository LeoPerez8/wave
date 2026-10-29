import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";

import { SongRow } from "@/songs/SongRow";
import { songRowPresentation } from "@/songs/songListModel";

/** The fixed fake song: plain artwork, no file and no Library id, so it never touches the Library. */
const SAMPLE = songRowPresentation(
  { kind: "history", id: "sample", title: "Sample song", artist: "Wave", durationMs: 200_000 },
  {},
  "sample",
);

const nothing = (): void => undefined;

type Props = Pick<
  ViewProps,
  | "accessibilityActions"
  | "onAccessibilityAction"
  | "onTouchStart"
  | "onTouchMove"
  | "onTouchEnd"
  | "onTouchCancel"
> & {
  accessibilityHint: string;
  /** Runs when the row is held for the long-press delay, as a real row's menu would open. */
  onLongPress?: (() => void) | undefined;
  /** Drawn behind the row, filling it (the Touch sample's fill). */
  behind?: ReactNode;
};

/**
 * Settings' sample song row: a fixed fake song ("Sample song", plain
 * artwork) drawn as a song row is, for the Motion and Touch samples to try
 * gestures on. Tapping it plays nothing. TalkBack reads it as one sample
 * ("Sample song row", then [accessibilityHint]), never as a song to play;
 * the touch handlers see the row's touches as they bubble up.
 */
export function SampleSongRow({ accessibilityHint, onLongPress, behind, ...rest }: Props) {
  return (
    <View
      {...rest}
      accessible
      accessibilityRole="none"
      accessibilityLabel="Sample song row"
      accessibilityHint={accessibilityHint}
    >
      {behind}
      <View importantForAccessibility="no-hide-descendants">
        <SongRow {...SAMPLE} onPress={nothing} onLongPress={onLongPress} />
      </View>
    </View>
  );
}
