import {
  PLAY_ACTION_LABELS,
  YT_ALBUM_DOWNLOAD_ACTION_LABELS,
  discoverSongs,
  menuLayout,
  ytAlbumSongs,
  type PlayCard,
} from "@wave/core";
import * as Result from "effect/Result";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL } from "@/catalog/grid";
import { pressedRect } from "@/motion/pressedRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { showMessage } from "@/overlay/alert";
import { CardHeading } from "@/overlay/CardHeading";
import { MenuChoices, type MenuChoice } from "@/overlay/MenuChoices";
import { followUp, openOverlay } from "@/overlay/overlay";
import { playDiscoverSongs, queueDiscoverSongs } from "@/playback/actions";

import { askYtMusic } from "./askYtMusic";
import { useLibraryFinder, useLoadedInLibrary } from "./libraryFinder";
import type { YtListHead } from "./routes";
import { runYtDownloadAction, useYtAlbumDownload } from "./YtDownloads";

/** A YT Music album as its tile knows it: its page (`MPREb_…`) and what the tile shows. */
export interface YtAlbumTarget extends YtListHead {
  readonly browseId: string;
}

/**
 * Opens a YT Music album's long-press menu next to its tile: Play, Play Next
 * and Add to Queue cards for its songs, then Shuffle, then Download Album, or
 * Cancel Album Download while its songs are on their way, or Retry Failed
 * after (Core's `ytAlbumDownload`). The album's page is read first (once a
 * session, see `readYtAlbum`), so the card opens with every entry it will have.
 */
export const openYtAlbumActions = (album: YtAlbumTarget): void => {
  const anchor = pressedRect();
  void followUp(async () => {
    const result = await askYtMusic((ytMusic) => ytMusic.album(album.browseId));
    if (Result.isFailure(result)) {
      await showMessage(
        album.title,
        result.failure.reason === "offline"
          ? "You're offline. YT Music albums need the network."
          : "No answer from YouTube Music. Try again in a moment.",
      );
      return;
    }
    const songs = ytAlbumSongs(album.browseId, result.success);
    openOverlay({
      label: album.title,
      anchor,
      render: (close) => <YtAlbumActionsMenu album={album} songs={songs} close={close} />,
    });
  });
};

/** The menu card: the album (unless its tile is highlighted), then its cards and entries. */
function YtAlbumActionsMenu({
  album,
  songs,
  close,
}: {
  album: YtAlbumTarget;
  songs: readonly NativeYtSong[];
  close: () => void;
}) {
  const find = useLibraryFinder();
  const inLibrary = useLoadedInLibrary();
  const download = useYtAlbumDownload(songs, inLibrary);
  // As its page plays them: the Library's files for the songs it has, the rest streamed.
  const listed = discoverSongs(songs, find);
  const context = { kind: "ytAlbum", id: album.browseId };
  const closing = (action: () => void) => () => {
    close();
    action();
  };
  const play = (shuffle: boolean) =>
    closing(() => void playDiscoverSongs(listed, undefined, context, { shuffle }));
  const layout = menuLayout(
    "ytAlbum",
    download.actions.map((action) => ({ action })),
  );
  const cards = layout.cards.map((action: PlayCard) => ({
    action,
    onPress:
      action === "play" ? play(false) : closing(() => void queueDiscoverSongs(listed, action)),
  }));
  const entries = layout.list.map(({ action }): MenuChoice =>
    action === "shuffle"
      ? { action, label: PLAY_ACTION_LABELS.shuffle, onPress: play(true) }
      : {
          action,
          label: YT_ALBUM_DOWNLOAD_ACTION_LABELS[action],
          onPress: closing(() => runYtDownloadAction(action, songs, inLibrary)),
        },
  );

  return (
    <>
      <CardHeading>
        <Artwork uri={album.artworkUrl ?? undefined} size={CELL * 5} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {album.title}
          </Text>
          {album.line !== "" && (
            <Text numberOfLines={1} className="font-sans text-body text-secondary">
              {album.line}
            </Text>
          )}
        </View>
      </CardHeading>
      <MenuChoices cards={cards} entries={entries} />
    </>
  );
}
