import { IconTrash } from "@tabler/icons-react-native";
import { downloadsSummary, type FailedDownload } from "@wave/core";
import { memo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { DownloadSongRow } from "@/settings/DownloadSongRow";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import {
  clearFailedDownloads,
  retryFailedDownloads,
  useFailedDownloads,
} from "@/ytmusic/YtDownloads";

/**
 * One failed song: its artwork, title and artists, why it failed (with what actually went
 * wrong when that adds something), Retry, and a trash button that clears it alone as Clear All
 * clears every song, without asking: its menu offers Download again. It only renders again when
 * what it shows or does changed, not each time a download on its way makes progress.
 */
const FailedDownloadRow = memo(
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
        <TextButton label="Retry" onPress={() => retryFailedDownloads([failed])} />
        <IconButton
          icon={IconTrash}
          label="Remove from failed downloads"
          onPress={() => clearFailedDownloads([failed])}
        />
      </DownloadSongRow>
    );
  },
  ({ failed: before, covers }, { failed: after, covers: coversAfter }) =>
    covers === coversAfter &&
    before.song === after.song &&
    before.line === after.line &&
    before.detail === after.detail &&
    before.clear.join() === after.clear.join() &&
    retryKey(before.retry) === retryKey(after.retry),
);

/** What a Retry asks for, to tell whether a row's Retry changed. */
const retryKey = (retry: FailedDownload<NativeYtSong>["retry"]): string =>
  retry.kind === "song" ? `song:${retry.song.videoId}` : `missingSong:${retry.trackId}`;

/**
 * Settings › Downloads, under the switch: the songs whose download failed (Core's
 * `failedDownloads`), with Retry All and Clear All above them. Nothing while none has.
 */
export function FailedDownloadsSection({ style }: { style?: StyleProp<ViewStyle> }) {
  const failed = useFailedDownloads();
  // With YT Music off Wave asks YouTube for nothing, covers included.
  const covers = useYtMusicEnabled();
  const summary = downloadsSummary(failed.length);
  if (summary === null) return null;
  return (
    <View style={style}>
      <CatalogLine className="mb-2">{summary}</CatalogLine>
      <View className="flex-row items-center" style={{ gap: CELL * 3 }}>
        <TextButton label="Retry All" onPress={() => retryFailedDownloads(failed)} />
        <TextButton label="Clear All" onPress={() => clearFailedDownloads(failed)} />
      </View>
      <Hairline />
      {failed.map((item) => (
        <FailedDownloadRow key={item.id} failed={item} covers={covers} />
      ))}
    </View>
  );
}
