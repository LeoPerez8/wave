import { downloadRunLines, downloadRunPanelLine } from "@wave/core";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import type { DownloadRunState } from "@/ytmusic/downloadRun";

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

/** The line saying YouTube's downloads are paused and when they try again (`useYoutubePauseNotice`). */
function PauseNotice({ notice }: { notice: string | null }) {
  return notice === null ? null : (
    <Text
      accessibilityLiveRegion="polite"
      className="font-sans text-footnote text-foreground"
      style={TABULAR}
    >
      {notice}
    </Text>
  );
}

/**
 * Settings › Downloads' run panel, atop the Downloading section: a bar, "1,234 of 2,500", how
 * many failed and are left, and "About 2 h left" once there's a pace (Core's
 * `downloadRunPanelLine`). While downloads are paused there's no time left: [pauseNotice] says
 * when YouTube's try again, else "Paused" while nothing downloads or saves. [summary] is the
 * section's "2 downloading · 5 waiting". Without a run, the summary and notice alone.
 */
export function DownloadRunPanel({
  run: { progress, timeLeft, paused },
  summary,
  pauseNotice,
}: {
  run: DownloadRunState;
  summary: string | null;
  pauseNotice: string | null;
}) {
  const overall = progress.overall;
  const lines = { gap: CELL, paddingBottom: CELL * 2 };
  if (overall === null) {
    return (
      <View style={lines}>
        {summary !== null && (
          <Text className="font-sans text-footnote text-secondary">{summary}</Text>
        )}
        <PauseNotice notice={pauseNotice} />
      </View>
    );
  }
  const { count, fraction } = downloadRunLines(overall);
  const line = downloadRunPanelLine(overall, { timeLeft, paused, throttled: pauseNotice !== null });
  return (
    <View style={lines}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${count} downloaded, ${line}`}
        accessibilityValue={{ min: 0, max: overall.total, now: overall.total - overall.left }}
        style={{ gap: CELL }}
      >
        <Text className="font-sans text-body font-semibold text-foreground" style={TABULAR}>
          {count}
        </Text>
        <RunBar fraction={fraction} />
        <Text className="font-sans text-footnote text-secondary" style={TABULAR}>
          {line}
        </Text>
      </View>
      {summary !== null && (
        <Text className="font-sans text-footnote text-secondary" style={TABULAR}>
          {summary}
        </Text>
      )}
      <PauseNotice notice={pauseNotice} />
    </View>
  );
}
