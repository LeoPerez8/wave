import { queuedDownloadsSummary, ytSongArtist, type QueuedDownload } from "@wave/core";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { cancelQueuedDownload, useQueuedDownloads } from "@/ytmusic/YtDownloads";

/**
 * One song on its way: its artwork, title and artists, the progress line its row shows
 * elsewhere, and Cancel until it's saving to the Library.
 */
function QueuedDownloadRow({
  queued,
  covers,
}: {
  queued: QueuedDownload<NativeYtSong>;
  covers: boolean;
}) {
  const { song, line, cancel } = queued;
  const artist = ytSongArtist(song);
  return (
    <View>
      <View className="flex-row items-center py-2" style={{ minHeight: grid.row, gap: CELL * 1.5 }}>
        <Artwork uri={covers ? (song.artworkUrl ?? undefined) : undefined} size={CELL * 5} />
        <View
          className="flex-1"
          accessible
          accessibilityLabel={[song.title, artist, line].filter(Boolean).join(", ")}
        >
          <Text className="font-sans text-body font-medium text-foreground">{song.title}</Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {artist}
          </Text>
          <Text className="font-sans text-footnote text-secondary">{line}</Text>
        </View>
        {cancel !== null && (
          <TextButton label="Cancel" onPress={() => cancelQueuedDownload(queued)} />
        )}
      </View>
      <Hairline />
    </View>
  );
}

/**
 * Settings › Downloads, above the failed songs: the songs on their way (Core's
 * `queuedDownloads`), the ones downloading first, then the waiting ones in queue order.
 * Nothing while none is.
 */
export function QueuedDownloadsSection() {
  const queued = useQueuedDownloads();
  // With YT Music off Wave asks YouTube for nothing, covers included.
  const covers = useYtMusicEnabled();
  const summary = queuedDownloadsSummary(queued);
  if (summary === null) return null;
  return (
    <View>
      <CatalogLine className="mb-2">{summary}</CatalogLine>
      <Hairline />
      {queued.map((item) => (
        <QueuedDownloadRow key={item.id} queued={item} covers={covers} />
      ))}
    </View>
  );
}
