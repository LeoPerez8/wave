import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import {
  discoverMixActions,
  discoverMixCaption,
  discoverMixPlaylist,
  menuLayout,
  placeDiscoverMixSongs,
  type BlendedDiscoverMix,
  type DiscoverMixAction,
  type PlayAction,
} from "@wave/core";
import { useMemo } from "react";
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

import { newSongsOf, useDiscoverMix, useLibraryTracks } from "./discoverMixes";

/**
 * Prepares local Library matches before opening the cached mix's menu, the
 * mix as the owner's level blends it.
 */
export const openDiscoverMixActions = (mix: BlendedDiscoverMix): void => {
  const anchor = pressedRect();
  void followUp(async () => {
    try {
      await currentLibraryFinder();
      openOverlay({
        label: discoverMixCaption(mix, currentLocalisation().strings).title,
        anchor,
        render: (close) => <DiscoverMixActionsMenu mix={mix} close={close} />,
      });
    } catch (error) {
      await showError(currentLocalisation().strings.discover.openMixFailed, error);
    }
  });
};

/** A one-time copy using the same Replace / Keep Both choice as a playlist import. */
const saveAsPlaylist = (mix: BlendedDiscoverMix): void => {
  const playlist = discoverMixPlaylist(mix, currentLocalisation().strings);
  void followUp(async () => {
    try {
      const saved = await saveImportedPlaylist(playlist.name, playlist.songs);
      void showToast(currentLocalisation().strings.discover.saved(saved.name));
    } catch (error) {
      await showError(currentLocalisation().strings.discover.saveMixFailed, error);
    }
  });
};

function DiscoverMixActionsMenu({
  mix: pressed,
  close,
}: {
  mix: BlendedDiscoverMix;
  close: () => void;
}) {
  const { strings } = useLocalisation();
  const find = useLibraryFinder();
  const tracks = useLibraryTracks();
  // Blended again without Library songs the Library no longer has (Home doesn't read every song).
  const mix = useDiscoverMix(pressed.id, tracks) ?? pressed;
  const inLibrary = useLoadedInLibrary();
  // Its songs that stream download (new ones, and familiar ones with no file); the rest are here.
  const fresh = useMemo(() => newSongsOf(mix), [mix]);
  const download = useYtAlbumDownload(fresh, inLibrary);
  const caption = discoverMixCaption(mix, strings);
  // As its page plays them, blended: the Library's files for the songs it has, the rest streamed.
  const listed = placeDiscoverMixSongs(mix, { find, track: (id) => tracks?.get(id) ?? null });
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
        runYtDownloadAction(action, fresh, inLibrary, {
          kind: "mix",
          id: mix.id,
          name: caption.title,
        });
    }
  };
  const layout = menuLayout("discoverMix", discoverMixActions(download, strings));
  const cards = layout.cards.map((action) => ({ action, onPress: run(action) }));
  const entries = layout.list.map((entry): MenuChoice => ({
    action: entry.action,
    label: "label" in entry ? entry.label : strings.itemActions.playLabels.shuffle,
    onPress: run(entry.action),
  }));

  return (
    <>
      <CardHeading>
        <Artwork uri={caption.artworkUrl ?? undefined} size={CELL * 5} />
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
