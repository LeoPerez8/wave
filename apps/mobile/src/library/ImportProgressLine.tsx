import { importProgressLine } from "@wave/core";
import { Text } from "react-native";

import { useLocalisation } from "@/localisation/localisation";

import { useImportProgress } from "./importProgress";

/**
 * An importing playlist's line under its length on its page (Core's
 * `importProgressLine`): "Waiting · 1,234 songs", "Reading 2,300 of
 * 10,000", "Matching with Library…", "Adding 340 of 10,000". Nothing once
 * it's done, or when its read failed (`YtLibraryReadLine` says so).
 */
export function ImportProgressLine({ playlistId }: { playlistId: number }) {
  const progress = useImportProgress(playlistId);
  const { language } = useLocalisation();
  if (progress === null) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      className="font-sans text-footnote text-accent"
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {importProgressLine(progress, language)}
    </Text>
  );
}
