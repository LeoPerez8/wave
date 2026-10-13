import {
  ITEM_ACTION_LABELS,
  YT_DOWNLOAD_ACTION_LABELS,
  entryDivider,
  ytDownloadActions,
  ytSongActions,
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
import { addYtToQueue, playYtNext } from "@/playback/actions";

import { useLoadedLibraryFinder } from "./libraryFinder";
import { cancelYtDownload, downloadYtSong, useYtDownloadStatus } from "./YtDownloads";

/**
 * Opens a YT Music song's long-press menu next to its row: Play Next and Add
 * to Queue (Core's `ytSongActions`), then Download, or Cancel Download /
 * Retry Download while one is on its way or has failed.
 */
export const openYtSongActions = (song: NativeYtSong): void => {
  openOverlay({
    label: song.title,
    anchor: pressedRect(),
    render: (close) => <YtSongActionsMenu song={song} close={close} />,
  });
};

/** One entry: joining the queue, or a download entry. */
type Entry =
  | { readonly kind: "queue"; readonly action: "playNext" | "addToQueue" }
  | { readonly kind: "download"; readonly action: YtDownloadAction };

const queueEntries = (): Entry[] =>
  ytSongActions().flatMap(({ action }): Entry[] =>
    action === "playNext" || action === "addToQueue" ? [{ kind: "queue", action }] : [],
  );

const label = (entry: Entry): string =>
  entry.kind === "queue"
    ? ITEM_ACTION_LABELS[entry.action]
    : YT_DOWNLOAD_ACTION_LABELS[entry.action];

const run = (entry: Entry, song: NativeYtSong): void => {
  switch (entry.action) {
    case "playNext":
      void playYtNext([song]);
      return;
    case "addToQueue":
      void addYtToQueue([song]);
      return;
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
  // A song downloaded earlier and since deleted from the Library can be downloaded again
  // (taken as still there until the Library has been read).
  const find = useLoadedLibraryFinder();
  const inLibrary = find === null || find(song) !== null;
  const entries: Entry[] = [
    ...queueEntries(),
    ...ytDownloadActions(status, { inLibrary }).map((action): Entry => ({
      kind: "download",
      action,
    })),
  ];
  const choose = (index: number) => {
    const entry = entries[index];
    if (entry === undefined) return;
    close();
    run(entry, song);
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
      <Hairline />
      <CardEntries listRef={trackList}>
        {entries.map((entry, index) => (
          <View key={entry.action} ref={trackEntry(index)} collapsable={false}>
            <EntryRow
              label={label(entry)}
              onPress={() => choose(index)}
              divider={entryDivider(index, entries.length, flow)}
              highlighted={index === underFinger}
            />
          </View>
        ))}
      </CardEntries>
    </>
  );
}
