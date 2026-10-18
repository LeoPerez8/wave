import { queuedDownloadsSummary, type DownloadGroup, type QueuedDownload } from "@wave/core";
import { memo, useMemo } from "react";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { DownloadSongRow } from "@/settings/DownloadSongRow";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { cancelQueuedDownload, useDownloadingList } from "@/ytmusic/YtDownloads";

/**
 * One song on its way: its artwork, title and artists, the progress line its row shows
 * elsewhere, and Cancel until it's saving to the Library. With hundreds queued, a row only
 * renders again when what it shows changed (its progress line, say), not on every journal change.
 */
const QueuedDownloadRow = memo(
  function QueuedDownloadRow({
    queued,
    covers,
  }: {
    queued: QueuedDownload<NativeYtSong>;
    covers: boolean;
  }) {
    const { song, line, cancel } = queued;
    return (
      <DownloadSongRow song={song} covers={covers} line={line}>
        {cancel !== null && (
          <TextButton label="Cancel" onPress={() => cancelQueuedDownload(queued)} />
        )}
      </DownloadSongRow>
    );
  },
  (before, after) =>
    before.covers === after.covers &&
    before.queued.song === after.queued.song &&
    before.queued.line === after.queued.line &&
    before.queued.cancel?.join() === after.queued.cancel?.join(),
);

/** A group's header: the playlist, album or mix its songs are from (or Songs), and how many are left. */
function DownloadGroupHeader({ group }: { group: DownloadGroup<NativeYtSong> }) {
  return (
    <View>
      <View
        className="flex-row items-baseline"
        style={{ gap: CELL * 1.5, paddingTop: CELL * 2, paddingBottom: CELL }}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${group.name}, ${group.line}`}
      >
        <Text
          numberOfLines={1}
          className="flex-1 font-sans text-body font-semibold text-foreground"
        >
          {group.name}
        </Text>
        <Text
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {group.line}
        </Text>
      </View>
      <Hairline />
    </View>
  );
}

/**
 * Settings › Downloads, above the failed songs: the Downloading section (Core's
 * `downloadingList`), the songs downloading now first, then the waiting ones grouped by the
 * playlist, album or mix they were asked from, in queue order, under how many of each there are.
 * Nothing while none is.
 */
export function QueuedDownloadsSection() {
  const { downloading, groups } = useDownloadingList();
  // With YT Music off Wave asks YouTube for nothing, covers included.
  const covers = useYtMusicEnabled();
  const summary = useMemo(
    () => queuedDownloadsSummary([...downloading, ...groups.flatMap((group) => group.queued)]),
    [downloading, groups],
  );
  if (summary === null) return null;
  return (
    <View>
      <CatalogLine className="mb-1">Downloading</CatalogLine>
      <Text className="mb-2 font-sans text-footnote text-secondary">{summary}</Text>
      <Hairline />
      {downloading.map((item) => (
        <QueuedDownloadRow key={item.id} queued={item} covers={covers} />
      ))}
      {groups.map((group) => (
        <View key={group.key}>
          <DownloadGroupHeader group={group} />
          {group.queued.map((item) => (
            <QueuedDownloadRow key={item.id} queued={item} covers={covers} />
          ))}
        </View>
      ))}
    </View>
  );
}
