import {
  ITEM_ACTION_LABELS,
  YT_ALBUM_DOWNLOAD_ACTION_LABELS,
  discoverSongs,
  entryDivider,
  ytAlbumSongs,
  type YtAlbumDownloadAction,
} from "@wave/core";
import * as Result from "effect/Result";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL } from "@/catalog/grid";
import { pressedRect } from "@/motion/pressedRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { showMessage } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { CardHeading } from "@/overlay/CardHeading";
import { useOverlayFlow } from "@/overlay/flow";
import { MenuRow } from "@/overlay/MenuRow";
import { followUp, openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";
import { queueDiscoverSongs } from "@/playback/actions";

import { askYtMusic } from "./askYtMusic";
import { useLibraryFinder, useLoadedInLibrary } from "./libraryFinder";
import type { YtListHead } from "./routes";
import { runYtDownloadAction, useYtAlbumDownload } from "./YtDownloads";

/** A YT Music album as its tile knows it: its page (`MPREb_…`) and what the tile shows. */
export interface YtAlbumTarget extends YtListHead {
  readonly browseId: string;
}

/**
 * Opens a YT Music album's long-press menu next to its tile: Play Next and
 * Add to Queue for its songs, then Download Album, or Cancel Album Download
 * while its songs are on their way, or Retry Failed after (Core's
 * `ytAlbumDownload`). The album's page is read first (once a session, see
 * `readYtAlbum`), so the card opens with every entry it will have.
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

type Entry =
  | { readonly kind: "queue"; readonly action: "playNext" | "addToQueue" }
  | { readonly kind: "download"; readonly action: YtAlbumDownloadAction };

const QUEUE_ENTRIES: readonly Entry[] = [
  { kind: "queue", action: "playNext" },
  { kind: "queue", action: "addToQueue" },
];

const label = (entry: Entry): string =>
  entry.kind === "queue"
    ? ITEM_ACTION_LABELS[entry.action]
    : YT_ALBUM_DOWNLOAD_ACTION_LABELS[entry.action];

/** The menu card: the album (unless its tile is highlighted), then its entries. */
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
  const entries: Entry[] = [
    ...QUEUE_ENTRIES,
    ...download.actions.map((action): Entry => ({ kind: "download", action })),
  ];
  const choose = (index: number) => {
    const entry = entries[index];
    if (entry === undefined) return;
    close();
    if (entry.kind === "queue") void queueDiscoverSongs(discoverSongs(songs, find), entry.action);
    else runYtDownloadAction(entry.action, songs, inLibrary);
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(choose);
  const flow = useOverlayFlow();

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
      {/* Play Next sits nearest the finger, whichever side of the tile the card opened on. */}
      <CardEntries listRef={trackList}>
        {entries.map((entry, index) => (
          <View key={entry.action} ref={trackEntry(index)} collapsable={false}>
            <MenuRow
              action={entry.action}
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
