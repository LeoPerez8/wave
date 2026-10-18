import { queuedDownloadsSummary, type QueuedDownload } from "@wave/core";
import { memo } from "react";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { DownloadSongRow } from "@/settings/DownloadSongRow";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { cancelQueuedDownload, useQueuedDownloads } from "@/ytmusic/YtDownloads";

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

/**
 * Settings › Downloads, above the failed songs: the Downloading section, the songs on their way
 * (Core's `queuedDownloads`), the ones downloading first, then the waiting ones in queue order,
 * under how many of each there are. Nothing while none is.
 */
export function QueuedDownloadsSection() {
  const queued = useQueuedDownloads();
  // With YT Music off Wave asks YouTube for nothing, covers included.
  const covers = useYtMusicEnabled();
  const summary = queuedDownloadsSummary(queued);
  if (summary === null) return null;
  return (
    <View>
      <CatalogLine className="mb-1">Downloading</CatalogLine>
      <Text className="mb-2 font-sans text-footnote text-secondary">{summary}</Text>
      <Hairline />
      {queued.map((item) => (
        <QueuedDownloadRow key={item.id} queued={item} covers={covers} />
      ))}
    </View>
  );
}
