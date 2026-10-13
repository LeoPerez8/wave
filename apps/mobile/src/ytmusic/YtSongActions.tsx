import {
  YT_DOWNLOAD_ACTION_LABELS,
  entryDivider,
  ytDownloadActions,
  ytSongCredit,
  type YtDownloadAction,
} from "@wave/core";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { pressedRect } from "@/motion/pressedRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";

import { cancelYtDownload, downloadYtSong, useYtDownloadStatus } from "./YtDownloads";

/**
 * Opens a YT Music song's long-press menu next to its row: Download, or
 * Cancel Download / Retry Download while one is on its way or has failed.
 */
export const openYtSongActions = (song: NativeYtSong): void => {
  openOverlay({
    label: song.title,
    anchor: pressedRect(),
    render: (close) => <YtSongActionsMenu song={song} close={close} />,
  });
};

const run = (action: YtDownloadAction, song: NativeYtSong): void => {
  switch (action) {
    case "download":
    case "retryDownload":
      downloadYtSong(song);
      return;
    case "cancelDownload":
      cancelYtDownload(song.videoId);
      return;
  }
};

/** The menu card: the song as its row shows it, then its entries, like a Library song's menu. */
function YtSongActionsMenu({ song, close }: { song: NativeYtSong; close: () => void }) {
  const status = useYtDownloadStatus(song.videoId);
  const actions = ytDownloadActions(status);
  const choose = (index: number) => {
    const action = actions[index];
    if (action === undefined) return;
    close();
    run(action, song);
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(choose);
  const flow = useOverlayFlow();

  return (
    <>
      <View
        className="flex-row items-center"
        style={{ paddingBottom: CELL * 1.5, gap: CELL * 1.5 }}
      >
        <Artwork uri={song.artworkUrl ?? undefined} size={CELL * 5} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {song.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {ytSongCredit(song)}
          </Text>
        </View>
      </View>
      {actions.length > 0 && <Hairline />}
      <CardEntries listRef={trackList}>
        {actions.map((action, index) => (
          <View key={action} ref={trackEntry(index)} collapsable={false}>
            <EntryRow
              label={YT_DOWNLOAD_ACTION_LABELS[action]}
              onPress={() => choose(index)}
              divider={entryDivider(index, actions.length, flow)}
              highlighted={index === underFinger}
            />
          </View>
        ))}
      </CardEntries>
    </>
  );
}
