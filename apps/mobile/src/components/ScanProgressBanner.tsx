import { IconAlertTriangle } from "@tabler/icons-react-native";
import { Text, View } from "react-native";

import { Button } from "@/components/Button";
import { useScanState } from "@/library/hooks";
import { startFullScan } from "@/library/runtime";
import { useThemeColor } from "@/theme/useThemeColor";

const count = (n: number): string => n.toLocaleString("en-US");

/** Scan progress (files found, then indexed) while a scan runs, or the error if it failed. */
export function ScanProgressBanner() {
  const scan = useScanState();
  const highlight = useThemeColor("highlight");

  if (scan.status === "failed") {
    return (
      <View className="mb-4 gap-2 rounded-2xl bg-fill p-4">
        <View className="flex-row items-center gap-2">
          <IconAlertTriangle size={20} color={highlight} strokeWidth={2} />
          <Text className="font-sans text-subheadline font-semibold text-foreground">
            Couldn't scan your music
          </Text>
        </View>
        <Text className="font-sans text-footnote text-secondary" numberOfLines={3}>
          {scan.message}
        </Text>
        <View className="items-start">
          <Button label="Try Again" variant="plain" onPress={startFullScan} />
        </View>
      </View>
    );
  }

  if (scan.status !== "scanning") return null;

  const reading = scan.phase === "reading";
  const fraction = reading && scan.filesFound > 0 ? scan.filesRead / scan.filesFound : 0;
  return (
    <View accessibilityRole="progressbar" className="mb-4 gap-2 rounded-2xl bg-fill p-4">
      <Text className="font-sans text-subheadline font-semibold text-foreground">
        {reading ? "Adding songs to your library" : "Looking for music…"}
      </Text>
      <Text className="font-sans text-footnote text-secondary">
        {reading
          ? `${count(scan.filesRead)} of ${count(scan.filesFound)} files indexed`
          : `${count(scan.filesFound)} files found`}
      </Text>
      <View className="h-1 overflow-hidden rounded-full bg-tertiary">
        <View
          className="h-1 rounded-full bg-accent"
          style={{ width: `${Math.round(Math.min(1, fraction) * 100)}%` }}
        />
      </View>
    </View>
  );
}
