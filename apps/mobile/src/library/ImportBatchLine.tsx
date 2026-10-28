import { ActivityIndicator, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { useThemeColor } from "@/theme/useThemeColor";

import { useImportBatchLine } from "./importProgress";

/**
 * The quiet line at the top of Library › Playlists while a batch of
 * playlists imports, From YT Music or From Spotify (Core's
 * `importBatchLine`): a spinner and "Importing playlists · 12 of 80", or
 * "Import paused · offline" with no spinner while the batch waits. Nothing
 * once the batch is done, nor for a From a Link import.
 */
export function ImportBatchLine() {
  const line = useImportBatchLine();
  const secondary = useThemeColor("secondary");
  if (line === null) return null;
  return (
    <View className="flex-row items-center" style={{ columnGap: CELL, paddingBottom: CELL * 2 }}>
      {line.paused ? null : <ActivityIndicator size="small" color={secondary} />}
      <Text
        accessibilityLiveRegion="polite"
        numberOfLines={1}
        className="font-sans text-footnote text-secondary"
        style={{ flexShrink: 1, fontVariant: ["tabular-nums"] }}
      >
        {line.text}
      </Text>
    </View>
  );
}
