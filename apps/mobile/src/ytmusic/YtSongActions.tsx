import { beginTiming } from "@/lib/timing";
import { currentLocalisation } from "@/localisation/localisation";
import {
  menuLayout,
  streamedArtistLink,
  shownSwipeEntry,
  swipesChoose,
  ytDownloadActions,
  ytSongActions,
  ytSongCredit,
  type SwipeSettings,
  type FavoriteSource,
  type PlaylistPlace,
  type PlaylistSong,
  type RowMenuAction,
  type StreamedArtistLink,
  type YtDownloadAction,
  type YtSongActionOptions,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { usePathname } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL } from "@/catalog/grid";
import { followStreamedArtistLink } from "@/library/ArtistChoice";
import { useYtSongStarred, ytSongStarredNow } from "@/library/favorites";
import { starSongs } from "@/library/starSongs";
import type { ArtistRow } from "@/library/LibraryStore";
import { openAddToPlaylist } from "@/library/PlaylistSheets";
import { removePlaylistItems } from "@/library/playlists";
import { currentPath } from "@/library/routes";
import { pressedMenuAllowed, pressedRect } from "@/motion/pressedRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { CardHeading } from "@/overlay/CardHeading";
import { MenuChoices, type MenuChoice, type PlayCardChoice } from "@/overlay/MenuChoices";
import { followUp, openOverlay } from "@/overlay/overlay";
import { addYtToQueue, playYtNext } from "@/playback/actions";
import { startMagicQueueFromStream } from "@/playback/magicQueueStart";
import type { MenuOptions } from "@/playback/ActionsMenu";
import type { RowSwipeOptions } from "@/playback/rowSwipe";
import { showError } from "@/overlay/alert";
import { swipeSettingsNow } from "@/settings/swipeActions";
import { ytMusicEnabled, useYtMusicEnabled } from "@/settings/ytMusic";
import { shareStreamedSong } from "@/share/songShare";

import {
  currentLibraryFinder,
  useLibraryFinder,
  useLoadedInLibrary,
  type FindInLibrary,
} from "./libraryFinder";
import { openYtAlbum, ytAlbumPageHere } from "./routes";
import { streamedArtistContextNow, useStreamedArtistLink } from "./streamedArtist";
import {
  cancelYtDownload,
  downloadYtSong,
  useYtDownloadStatus,
  ytDownloadStatusNow,
} from "./YtDownloads";

/** Where the menu was opened: a playlist's entry offers Remove from Playlist. */
export interface YtSongMenuOptions extends MenuOptions {
  readonly playlistItem?: PlaylistPlace | undefined;
}

/**
 * Opens a YT Music song's long-press menu next to its row: Play Next and Add
 * to Queue as cards, then Add to Playlist, Favorite or Remove from Favorites (a star means
 * downloaded: Favorite queues its download), Remove from Playlist for a playlist's entry, Go to
 * Album and Go to Artist (Core's `ytSongActions`), then Download, or Cancel Download /
 * Retry Download while one is on its way or has failed. Go to Artist is there from its first frame; unread names resolve only on its tap.
 */
export const openYtSongActions = (song: NativeYtSong, options: YtSongMenuOptions = {}): void => {
  const anchor = pressedRect();
  const allowed = pressedMenuAllowed();
  // The row stays highlighted meanwhile: the card opens inside the follow-up.
  void followUp(() =>
    Promise.resolve().then(() => {
      if (!allowed()) return;
      openOverlay({
        label: song.title,
        anchor,
        render: (close) => (
          <YtSongActionsMenu
            song={song}
            playlistItem={options.playlistItem}
            onSelect={options.onSelect}
            playing={options.playing}
            close={close}
          />
        ),
      });
    }),
  );
};

/** One entry: joining the queue or a playlist, going to the album or artist, or a download entry. */
type Entry =
  | {
      readonly kind: "queue";
      readonly action:
        | "playNext"
        | "addToQueue"
        | "magicQueue"
        | "addToPlaylist"
        | "removeFromPlaylist"
        | "share"
        | "select";
    }
  | { readonly kind: "album"; readonly action: "goToAlbum"; readonly album: string }
  | {
      readonly kind: "artist";
      readonly action: "goToArtist";
      readonly artists: StreamedArtistLink<ArtistRow>;
    }
  | { readonly kind: "download"; readonly action: YtDownloadAction }
  | { readonly kind: "star"; readonly action: "favorite" | "unfavorite" };

const songEntries = (
  artists: StreamedArtistLink<ArtistRow> | undefined,
  options: YtSongActionOptions,
): Entry[] =>
  ytSongActions(artists, options).map((entry): Entry => {
    switch (entry.action) {
      case "goToAlbum":
        return { kind: "album", ...entry };
      case "goToArtist":
        return { kind: "artist", ...entry };
      case "favorite":
      case "unfavorite":
        return { kind: "star", action: entry.action };
      default:
        return { kind: "queue", action: entry.action };
    }
  });

/** The entry's label in the app's language (the menu is built as it opens). */
const label = (entry: Entry): string =>
  currentLocalisation().strings.itemActions.labels[entry.action];

/** What [song] joins a playlist as: the Library's song when it has it, else the stream. */
const playlistSong = (song: NativeYtSong, find: FindInLibrary): PlaylistSong => {
  const track = find(song);
  return track === null ? { source: "stream", song } : { source: "library", trackId: track.id };
};

/** Where the menu acts: the Library finder, and what its list gave it (`YtSongMenuOptions`). */
interface MenuPlace {
  readonly find: FindInLibrary;
  readonly playlistItem: PlaylistPlace | undefined;
  readonly onSelect: (() => void) | undefined;
}

const run = (
  entry: Entry,
  song: NativeYtSong,
  { find, playlistItem, onSelect }: MenuPlace,
  source: FavoriteSource,
): void => {
  if (entry.kind === "album") {
    // The page heads with what the song knows of its album until the page is read.
    openYtAlbum(entry.album, { title: song.album ?? "", line: "", artworkUrl: song.artworkUrl });
    return;
  }
  if (entry.kind === "artist") {
    beginTiming("goToArtist", "Artist");
    followStreamedArtistLink(entry.artists);
    return;
  }
  if (entry.kind === "star") {
    // A star means downloaded: the song joins the download queue with it.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void starSongs({ tracks: [], ytSongs: [song] }, entry.action === "favorite", find, source);
    return;
  }
  switch (entry.action) {
    case "playNext":
      void playYtNext([song]);
      return;
    case "addToQueue":
      void addYtToQueue([song]);
      return;
    case "magicQueue":
      startMagicQueueFromStream(song, find(song));
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
        showError(currentLocalisation().strings.library.couldntRemoveSong, error),
      );
      return;
    case "download":
    case "retryDownload":
      downloadYtSong(song);
      return;
    case "cancelDownload":
      cancelYtDownload(song.videoId);
      return;
    case "share":
      // The song share sheet, with YouTube's cover cached on the phone.
      shareStreamedSong(song);
      return;
    case "select":
      onSelect?.();
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
  onSelect,
  playing,
  close,
}: {
  song: NativeYtSong;
  playlistItem: PlaylistPlace | undefined;
  onSelect: (() => void) | undefined;
  /** The song is the one playing: no Play Next or Add to Queue. */
  playing: boolean | undefined;
  close: () => void;
}) {
  const status = useYtDownloadStatus(song.videoId);
  const find = useLibraryFinder();
  // A song downloaded earlier and since deleted from the Library can be downloaded again
  // (taken as still there until the Library has been read).
  const inLibrary = useLoadedInLibrary()(song);
  // Starred as its pending favorite, or as the Library song it is by now.
  const track = find(song);
  const favorite = useYtSongStarred(song.videoId, track);
  // Its artists open integrated: their Library page, else the YouTube Music artist page.
  // Kept as the menu opened with it, so Go to Artist never appears while it's shown.
  const link = useStreamedArtistLink(song.artists);
  const [artists] = useState(link);
  // A playlist's entry opens this menu with YT Music off too: then nothing is asked of YouTube.
  const ytMusic = useYtMusicEnabled();
  // Go to Album leaves out the YT Music album page you're on.
  const ytAlbumHere = ytAlbumPageHere(usePathname());
  const entries: Entry[] = [
    ...songEntries(artists, {
      inPlaylist: playlistItem !== undefined,
      favorite,
      album: song.albumId,
      ytAlbumHere,
      ytMusic,
      selectable: onSelect !== undefined,
      playing,
    }),
    ...ytDownloadActions(status, { inLibrary }).map((action): Entry => ({
      kind: "download",
      action,
    })),
  ];
  const choose = (entry: Entry) => () => {
    close();
    run(entry, song, { find, playlistItem, onSelect }, "menu");
  };
  // Play Next and Add to Queue are its cards; a tap already plays it (Core's `menuLayout`).
  const layout = menuLayout("ytSong", entries);
  const cards = layout.cards.flatMap((card): PlayCardChoice[] => {
    const entry = entries.find(({ action }) => action === card);
    return entry === undefined ? [] : [{ action: card, onPress: choose(entry) }];
  });
  const list = layout.list.flatMap((entry): MenuChoice[] =>
    "kind" in entry ? [{ action: entry.action, label: label(entry), onPress: choose(entry) }] : [],
  );

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
      <MenuChoices cards={cards} entries={list} />
    </>
  );
}

/**
 * Runs the swipe a shared song-list row showed ([shown]): the menu is planned
 * again with the current route and stars, and its entry for [shown] runs.
 */
export const runYtSongSwipe = (
  song: NativeYtSong,
  shown: RowMenuAction,
  options: RowSwipeOptions = {},
): void => {
  const settings = swipeSettingsNow();
  const ytMusic = ytMusicEnabled();
  const { playlistItem } = options;

  const entriesWith = (find: FindInLibrary, at: string, inLibrary: boolean) =>
    ytSongSwipeEntries(song, options, settings, ytMusic, find, at, inLibrary);

  if (shown === "goToArtist") {
    const artistEntry = shownSwipeEntry(
      entriesWith(() => null, currentPath(), false),
      shown,
    );
    if (artistEntry !== undefined)
      run(artistEntry, song, { find: () => null, playlistItem, onSelect: undefined }, "swipe");
    return;
  }
  currentLibraryFinder()
    .then((find) => {
      const entry = shownSwipeEntry(entriesWith(find, currentPath(), find(song) !== null), shown);
      if (entry !== undefined)
        run(entry, song, { find, playlistItem, onSelect: undefined }, "swipe");
    })
    .catch((error: unknown) => showError(currentLocalisation().strings.playbackText.couldntLoadTheSong, error));
};

const ytSongSwipeEntries = (
  song: NativeYtSong,
  { playlistItem }: RowSwipeOptions,
  settings: SwipeSettings,
  ytMusic: boolean,
  find: FindInLibrary,
  at: string,
  inLibrary: boolean,
): Entry[] => {
  const artists = swipesChoose(settings, "goToArtist") ? streamedArtistContextNow() : undefined;
  return [
    ...songEntries(
      artists === undefined ? undefined : streamedArtistLink(song.artists ?? [], artists),
      {
        inPlaylist: playlistItem !== undefined,
        favorite: ytSongStarredNow(song.videoId, find(song)),
        album: song.albumId,
        ytAlbumHere: ytAlbumPageHere(at),
        ytMusic,
        selectable: false,
      },
    ),
    ...(swipesChoose(settings, "download")
      ? ytDownloadActions(ytDownloadStatusNow(song.videoId), { inLibrary }).map(
          (action): Entry => ({ kind: "download", action }),
        )
      : []),
  ];
};
