import {
  ITEM_ACTION_LABELS,
  YT_DOWNLOAD_ACTION_LABELS,
  entryDivider,
  ytDownloadActions,
  ytSongActions,
  ytSongCredit,
  type PlaylistPlace,
  type PlaylistSong,
  type StreamedArtistLink,
  type YtDownloadAction,
} from "@wave/core";
import { useState } from "react";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { followStreamedArtistLink } from "@/library/ArtistChoice";
import type { ArtistRow } from "@/library/LibraryStore";
import { openAddToPlaylist } from "@/library/PlaylistSheets";
import { removePlaylistItems } from "@/library/playlists";
import { pressedRect } from "@/motion/pressedRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { CardEntries } from "@/overlay/CardEntries";
import { CardHeading } from "@/overlay/CardHeading";
import { useOverlayFlow } from "@/overlay/flow";
import { followUp, openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";
import { addYtToQueue, playYtNext } from "@/playback/actions";
import { showError } from "@/overlay/alert";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useLibraryFinder, useLoadedInLibrary, type FindInLibrary } from "./libraryFinder";
import { libraryArtistsRead, useStreamedArtistLink } from "./streamedArtist";
import { cancelYtDownload, downloadYtSong, useYtDownloadStatus } from "./YtDownloads";

/** Where the menu was opened: a playlist's entry offers Remove from Playlist. */
export interface YtSongMenuOptions {
  readonly playlistItem?: PlaylistPlace | undefined;
}

/**
 * Opens a YT Music song's long-press menu next to its row: Play Next, Add to
 * Queue, Add to Playlist (Remove from Playlist for a playlist's entry) and Go
 * to Artist (Core's `ytSongActions`), then Download, or Cancel Download /
 * Retry Download while one is on its way or has failed. It opens once the
 * Library's artists are read, so Go to Artist is there from its first frame
 * (or, the read failing or slow, not at all: the menu never grows).
 */
export const openYtSongActions = (song: NativeYtSong, options: YtSongMenuOptions = {}): void => {
  const anchor = pressedRect();
  // The row stays highlighted meanwhile: the card opens inside the follow-up.
  void followUp(() =>
    libraryArtistsRead().then(() => {
      openOverlay({
        label: song.title,
        anchor,
        render: (close) => (
          <YtSongActionsMenu song={song} playlistItem={options.playlistItem} close={close} />
        ),
      });
    }),
  );
};

/** One entry: joining the queue or a playlist, going to the artist, or a download entry. */
type Entry =
  | {
      readonly kind: "queue";
      readonly action: "playNext" | "addToQueue" | "addToPlaylist" | "removeFromPlaylist";
    }
  | {
      readonly kind: "artist";
      readonly action: "goToArtist";
      readonly artists: StreamedArtistLink<ArtistRow>;
    }
  | { readonly kind: "download"; readonly action: YtDownloadAction };

const songEntries = (
  artists: StreamedArtistLink<ArtistRow> | undefined,
  inPlaylist: boolean,
): Entry[] =>
  ytSongActions(artists, { inPlaylist }).map((entry): Entry =>
    entry.action === "goToArtist"
      ? { kind: "artist", ...entry }
      : { kind: "queue", action: entry.action },
  );

const label = (entry: Entry): string =>
  entry.kind === "download"
    ? YT_DOWNLOAD_ACTION_LABELS[entry.action]
    : ITEM_ACTION_LABELS[entry.action];

/** What [song] joins a playlist as: the Library's song when it has it, else the stream. */
const playlistSong = (song: NativeYtSong, find: FindInLibrary): PlaylistSong => {
  const track = find(song);
  return track === null ? { source: "stream", song } : { source: "library", trackId: track.id };
};

const run = (
  entry: Entry,
  song: NativeYtSong,
  find: FindInLibrary,
  playlistItem: PlaylistPlace | undefined,
): void => {
  if (entry.kind === "artist") {
    followStreamedArtistLink(entry.artists);
    return;
  }
  switch (entry.action) {
    case "playNext":
      void playYtNext([song]);
      return;
    case "addToQueue":
      void addYtToQueue([song]);
      return;
    case "addToPlaylist":
      openAddToPlaylist({
        title: song.title,
        songs: () => Promise.resolve([playlistSong(song, find)]),
      });
      return;
    case "removeFromPlaylist":
      if (playlistItem === undefined) return;
      removePlaylistItems(playlistItem.playlistId, [playlistItem.itemId]).catch((error: unknown) =>
        showError("Couldn't remove the song", error),
      );
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

/**
 * The menu card: the song as its row shows it (unless that row is highlighted),
 * then its entries, like a Library song's menu.
 */
function YtSongActionsMenu({
  song,
  playlistItem,
  close,
}: {
  song: NativeYtSong;
  playlistItem: PlaylistPlace | undefined;
  close: () => void;
}) {
  const status = useYtDownloadStatus(song.videoId);
  const find = useLibraryFinder();
  // A song downloaded earlier and since deleted from the Library can be downloaded again
  // (taken as still there until the Library has been read).
  const inLibrary = useLoadedInLibrary()(song);
  // Its artists open integrated: their Library page, else the YouTube Music artist page.
  // Kept as the menu opened with it, so Go to Artist never appears while it's shown.
  const link = useStreamedArtistLink(song.artists);
  const [artists] = useState(link);
  const entries: Entry[] = [
    ...songEntries(artists, playlistItem !== undefined),
    ...ytDownloadActions(status, { inLibrary }).map((action): Entry => ({
      kind: "download",
      action,
    })),
  ];
  const choose = (index: number) => {
    const entry = entries[index];
    if (entry === undefined) return;
    close();
    run(entry, song, find, playlistItem);
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(choose);
  const flow = useOverlayFlow();
  // A playlist's entry opens this menu with YT Music off too: then nothing is asked of YouTube.
  const ytMusic = useYtMusicEnabled();

  return (
    <>
      <CardHeading>
        <Artwork uri={ytMusic ? (song.artworkUrl ?? undefined) : undefined} size={CELL * 5} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {song.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {ytSongCredit(song)}
          </Text>
        </View>
      </CardHeading>
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
