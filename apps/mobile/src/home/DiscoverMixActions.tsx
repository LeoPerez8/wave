import {
  discoverMixActions,
  discoverMixCaption,
  discoverMixPlaylist,
  discoverSongs,
  entryDivider,
  type DiscoverMix,
} from "@wave/core";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { saveImportedPlaylist } from "@/library/importPlaylists";
import { pressedRect } from "@/motion/pressedRect";
import { showError } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { CardHeading } from "@/overlay/CardHeading";
import { useOverlayFlow } from "@/overlay/flow";
import { followUp, openOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";
import { queueDiscoverSongs } from "@/playback/actions";
import {
  currentLibraryFinder,
  useLibraryFinder,
  useLoadedInLibrary,
} from "@/ytmusic/libraryFinder";
import { runYtDownloadAction, useYtAlbumDownload } from "@/ytmusic/YtDownloads";

/** Prepares local Library matches before opening the cached mix's menu. */
export const openDiscoverMixActions = (mix: DiscoverMix): void => {
  const anchor = pressedRect();
  void followUp(async () => {
    try {
      await currentLibraryFinder();
      openOverlay({
        label: discoverMixCaption(mix).title,
        anchor,
        render: (close) => <DiscoverMixActionsMenu mix={mix} close={close} />,
      });
    } catch (error) {
      await showError("Couldn't open the mix's actions", error);
    }
  });
};

/** A one-time copy using the same Replace / Keep Both choice as a playlist import. */
const saveAsPlaylist = (mix: DiscoverMix): void => {
  const playlist = discoverMixPlaylist(mix);
  void followUp(async () => {
    try {
      const saved = await saveImportedPlaylist(playlist.name, playlist.songs);
      void showToast(`Saved ${saved.name}`);
    } catch (error) {
      await showError("Couldn't save the mix as a playlist", error);
    }
  });
};

function DiscoverMixActionsMenu({ mix, close }: { mix: DiscoverMix; close: () => void }) {
  const find = useLibraryFinder();
  const inLibrary = useLoadedInLibrary();
  const download = useYtAlbumDownload(mix.songs, inLibrary);
  const entries = discoverMixActions(download);
  const caption = discoverMixCaption(mix);
  const choose = (index: number) => {
    const entry = entries[index];
    if (entry === undefined) return;
    close();
    switch (entry.action) {
      case "playNext":
      case "addToQueue":
        void queueDiscoverSongs(discoverSongs(mix.songs, find), entry.action);
        return;
      case "saveAsPlaylist":
        saveAsPlaylist(mix);
        return;
      default:
        runYtDownloadAction(entry.action, mix.songs, inLibrary, {
          kind: "mix",
          id: mix.id,
          name: caption.title,
        });
    }
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(choose);
  const flow = useOverlayFlow();

  return (
    <>
      <CardHeading>
        <Artwork uri={mix.songs[0]?.artworkUrl ?? undefined} size={CELL * 5} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {caption.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {caption.artists}
          </Text>
        </View>
      </CardHeading>
      <CardEntries listRef={trackList}>
        {entries.map((entry, index) => (
          <View key={entry.action} ref={trackEntry(index)} collapsable={false}>
            <EntryRow
              label={entry.label}
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
