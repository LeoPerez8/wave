import {
  sameFailedDownload,
  type FailedDownload,
  type FailedGroupRow,
  type FailedHeaderRow,
} from "@wave/core";
import { memo } from "react";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { DownloadSongRow } from "@/settings/DownloadSongRow";
import { SECTION_GAP } from "@/settings/SettingsPage";
import { clearFailedDownloads, retryFailedDownloads } from "@/ytmusic/YtDownloads";

/**
 * Settings › Downloads' failed songs are rows of the page's one virtualized list (Core's
 * `failedDownloadRows`), under the songs on their way: this header, then while it's expanded the
 * songs grouped by why they failed. None of these rows draws an SVG or carries an animated style
 * of its own: with hundreds of failed songs either froze the page (#446, #465).
 */

/**
 * The failed section's top row: how many songs failed, Retry All and Clear All for every one
 * ([failed]), and Show or Hide for the songs themselves (collapsed by default).
 */
export const FailedSectionHeader = memo(function FailedSectionHeader({
  row,
  failed,
  onToggle,
}: {
  row: FailedHeaderRow;
  failed: readonly FailedDownload<NativeYtSong>[];
  onToggle: () => void;
}) {
  return (
    <View style={{ marginTop: SECTION_GAP }}>
      <CatalogLine className="mb-2">{row.line}</CatalogLine>
      <View className="flex-row items-center" style={{ gap: CELL * 3 }}>
        <TextButton
          variant="plain"
          label="Retry All"
          onPress={() => retryFailedDownloads(failed)}
        />
        <TextButton
          variant="plain"
          label="Clear All"
          onPress={() => clearFailedDownloads(failed)}
        />
        <View className="flex-1" />
        <TextButton
          variant="plain"
          label={row.expanded ? "Hide Songs" : "Show Songs"}
          accessibilityLabel={row.expanded ? "Hide failed songs" : "Show failed songs"}
          onPress={onToggle}
        />
      </View>
      <Hairline />
    </View>
  );
});

/** Two lists of failed songs that show and do the same. */
const sameFailedList = (
  a: readonly FailedDownload<NativeYtSong>[],
  b: readonly FailedDownload<NativeYtSong>[],
) =>
  a === b ||
  (a.length === b.length && a.every((each, index) => sameFailedDownload(each, b[index] ?? each)));

/**
 * The header of the songs that failed for one reason: the reason and how many, then Retry and
 * Remove for all of them.
 */
export const FailedGroupHeader = memo(
  function FailedGroupHeader({ row }: { row: FailedGroupRow<NativeYtSong> }) {
    return (
      <View>
        <View className="flex-row items-center" style={{ gap: CELL * 3, paddingTop: CELL }}>
          <Text
            className="flex-1 font-sans text-body font-semibold text-foreground"
            accessibilityRole="header"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {row.line}
          </Text>
          <TextButton
            variant="plain"
            label="Retry"
            accessibilityLabel={`Retry ${row.line}`}
            onPress={() => retryFailedDownloads(row.failed)}
          />
          <TextButton
            variant="plain"
            label="Remove"
            accessibilityLabel={`Remove ${row.line} from failed downloads`}
            onPress={() => clearFailedDownloads(row.failed)}
          />
        </View>
        <Hairline />
      </View>
    );
  },
  (before, after) =>
    before.row.line === after.row.line && sameFailedList(before.row.failed, after.row.failed),
);

/**
 * One failed song: its artwork, title and artists, why it failed (with what actually went wrong
 * when that adds something), Retry, and Remove, which clears it alone as Clear All clears every
 * song, without asking: its menu offers Download again. It only renders again when what it shows
 * or does changed (Core's `sameFailedDownload`).
 */
export const FailedDownloadRow = memo(
  function FailedDownloadRow({
    failed,
    covers,
  }: {
    failed: FailedDownload<NativeYtSong>;
    covers: boolean;
  }) {
    const { song, line, detail } = failed;
    return (
      <DownloadSongRow song={song} covers={covers} line={line} detail={detail}>
        <TextButton variant="plain" label="Retry" onPress={() => retryFailedDownloads([failed])} />
        <TextButton
          variant="plain"
          label="Remove"
          accessibilityLabel="Remove from failed downloads"
          onPress={() => clearFailedDownloads([failed])}
        />
      </DownloadSongRow>
    );
  },
  (before, after) =>
    before.covers === after.covers && sameFailedDownload(before.failed, after.failed),
);
