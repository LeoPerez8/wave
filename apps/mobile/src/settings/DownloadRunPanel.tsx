import { downloadRunLines, downloadTimeLeftLine, type DownloadRunCounts } from "@wave/core";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import type { DownloadRunState } from "@/ytmusic/YtDownloads";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/**
 * A run's (or group's) progress bar: plain views, no SVG and no animated style, so a page of
 * group headers stays light however many there are.
 */
export function RunBar({ fraction }: { fraction: number }) {
  return (
    <View className="overflow-hidden rounded-full bg-separator" style={{ height: CELL / 2 }}>
      <View
        className="rounded-full bg-accent"
        style={{ height: CELL / 2, width: `${Math.round(Math.min(1, fraction) * 1000) / 10}%` }}
      />
    </View>
  );
}

/** A group header's line: "40 of 120 · 2 failed · 80 left" (Core's `downloadRunLines`). */
export const groupRunLine = (counts: DownloadRunCounts): string => {
  const { count, detail } = downloadRunLines(counts);
  return `${count} · ${detail}`;
};

/**
 * Settings › Downloads' run panel, atop the Downloading section: a bar, "1,234 of 2,500", how
 * many failed and are left, and "About 2 h left" once there's a pace (Core's
 * `downloadTimeLeft`), or "Paused" while nothing downloads or saves. [summary] is the
 * section's "2 downloading · 5 waiting". Nothing without a run.
 */
export function DownloadRunPanel({
  run: { progress, timeLeft, paused },
  summary,
}: {
  run: DownloadRunState;
  summary: string | null;
}) {
  const overall = progress.overall;
  if (overall === null) {
    return summary === null ? null : (
      <Text className="mb-2 font-sans text-footnote text-secondary">{summary}</Text>
    );
  }
  const { count, detail, fraction } = downloadRunLines(overall);
  const time = paused ? "Paused" : timeLeft === null ? null : downloadTimeLeftLine(timeLeft);
  const line = time === null ? detail : `${detail} · ${time}`;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${count} downloaded, ${line}`}
      accessibilityValue={{ min: 0, max: overall.total, now: overall.total - overall.left }}
      style={{ gap: CELL, paddingBottom: CELL * 2 }}
    >
      <Text className="font-sans text-body font-semibold text-foreground" style={TABULAR}>
        {count}
      </Text>
      <RunBar fraction={fraction} />
      <Text className="font-sans text-footnote text-secondary" style={TABULAR}>
        {line}
      </Text>
      {summary !== null && (
        <Text className="font-sans text-footnote text-secondary" style={TABULAR}>
          {summary}
        </Text>
      )}
    </View>
  );
}
