import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useScanState } from "@/library/hooks";
import { startRescan } from "@/library/runtime";

const count = (n: number): string => n.toLocaleString("en");

/**
 * Scan progress (files found, then indexed) while a scan runs, or the error if
 * it failed. Incremental rescans stay quiet unless there are files to read.
 */
export function ScanProgressBanner() {
  const scan = useScanState();

  if (scan.status === "failed") {
    return (
      <View style={{ gap: CELL, paddingBottom: CELL * 2 }}>
        <CatalogLine>Couldn't scan your music</CatalogLine>
        <Text className="font-sans text-footnote text-secondary" numberOfLines={3}>
          {scan.message}
        </Text>
        <View className="items-start">
          <TextButton label="Try again" onPress={() => void startRescan()} />
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
  return (
    <View accessibilityRole="progressbar" style={{ gap: CELL, paddingBottom: CELL * 3 }}>
      <CatalogLine tone="accent">
        {incremental
          ? "Updating your library"
          : reading
            ? "Adding songs to your library"
            : "Looking for music"}
      </CatalogLine>
      <Text
        className="font-sans text-footnote text-secondary"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {incremental
          ? `${count(scan.filesRead)} of ${count(toRead)} new or changed files read`
          : reading
            ? `${count(scan.filesRead)} of ${count(toRead)} files indexed`
            : `${count(scan.filesFound)} files found`}
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
