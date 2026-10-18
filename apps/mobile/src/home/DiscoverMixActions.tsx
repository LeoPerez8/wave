import {
  PLAY_ACTION_LABELS,
  discoverMixActions,
  discoverMixCaption,
  discoverMixPlaylist,
  discoverSongs,
  menuLayout,
  type DiscoverMix,
  type DiscoverMixAction,
  type PlayAction,
} from "@wave/core";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL } from "@/catalog/grid";
import { saveImportedPlaylist } from "@/library/importPlaylists";
import { pressedRect } from "@/motion/pressedRect";
import { showError } from "@/overlay/alert";
import { CardHeading } from "@/overlay/CardHeading";
import { MenuChoices, type MenuChoice } from "@/overlay/MenuChoices";
import { followUp, openOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { playDiscoverSongs, queueDiscoverSongs } from "@/playback/actions";
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
  const caption = discoverMixCaption(mix);
  // As its page plays them: the Library's files for the songs it has, the rest streamed.
  const listed = discoverSongs(mix.songs, find);
  const context = { kind: "discoverMix", id: mix.id };
  const run = (action: DiscoverMixAction | PlayAction) => () => {
    close();
    switch (action) {
      case "play":
      case "shuffle":
        void playDiscoverSongs(listed, undefined, context, { shuffle: action === "shuffle" });
        return;
      case "playNext":
      case "addToQueue":
        void queueDiscoverSongs(listed, action);
        return;
      case "saveAsPlaylist":
        saveAsPlaylist(mix);
        return;
      default:
        runYtDownloadAction(action, mix.songs, inLibrary);
    }
  };
  const layout = menuLayout("discoverMix", discoverMixActions(download));
  const cards = layout.cards.map((action) => ({ action, onPress: run(action) }));
  const entries = layout.list.map((entry): MenuChoice => ({
    action: entry.action,
    label: "label" in entry ? entry.label : PLAY_ACTION_LABELS.shuffle,
    onPress: run(entry.action),
  }));

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
      <MenuChoices cards={cards} entries={entries} />
    </>
  );
}
