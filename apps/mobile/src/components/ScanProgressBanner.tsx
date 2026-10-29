import { formatNumber } from "@wave/core";
import { useLocalisation } from "@/localisation/localisation";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useScanProgress } from "@/library/hooks";
import { startRescan } from "@/library/runtime";

/**
 * Scan progress (files found, then indexed) while a scan runs, or the error if
 * it failed. Incremental rescans stay quiet unless there are files to read.
 */
export function ScanProgressBanner() {
  const { language, strings } = useLocalisation();
  const scan = useScanProgress();
  const count = (value: number) => formatNumber(language, value);

  if (scan.status === "failed") {
    return (
      <View style={{ gap: CELL, paddingBottom: CELL * 2 }}>
        {/* Announced as it appears, and whole: the cause is what tells a retry from a fix.
            Try again stays its own stop after it. */}
        <View accessibilityLiveRegion="polite" style={{ gap: CELL }}>
          <CatalogLine>{strings.settings.couldntScanYourMusic}</CatalogLine>
          <Text className="font-sans text-footnote text-secondary">{scan.message}</Text>
        </View>
        <View className="items-start">
          <TextButton label={strings.settings.tryAgainText} onPress={() => void startRescan()} />
        </View>
        <Hairline />
      </View>
    );
  }

  if (scan.status !== "scanning") return null;

  const reading = scan.phase === "reading";
  const toRead = scan.filesFound - scan.filesUnchanged;
  const incremental = scan.kind === "incremental";
  if (incremental && (!reading || toRead === 0)) return null;
  const fraction = reading && toRead > 0 ? scan.filesRead / toRead : 0;
  const title = incremental
    ? strings.settings.updatingYourLibrary
    : reading
      ? strings.settings.addingSongsToYourLibrary
      : strings.settings.lookingForMusic;
  const detail = incremental
    ? strings.settings.newFiles(count(scan.filesRead), count(toRead))
    : reading
      ? strings.settings.indexedFiles(count(scan.filesRead), count(toRead))
      : strings.settings.foundFiles(count(scan.filesFound), scan.filesFound);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={title}
      accessibilityState={{ busy: true }}
      accessibilityValue={
        reading && toRead > 0
          ? { min: 0, max: toRead, now: Math.min(scan.filesRead, toRead), text: detail }
          : { text: detail }
      }
      style={{ gap: CELL, paddingBottom: CELL * 3 }}
    >
      <CatalogLine tone="accent">{title}</CatalogLine>
      <Text
        className="font-sans text-footnote text-secondary"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {detail}
      </Text>
      <View className="bg-separator" style={{ height: CELL / 4 }}>
        <View
          className="bg-accent"
          style={{ height: CELL / 4, width: `${Math.round(Math.min(1, fraction) * 100)}%` }}
        />
      </View>
    </View>
  );
}
