import {
  ITEM_ACTION_LABELS,
  YT_DOWNLOAD_ACTION_LABELS,
  menuLayout,
  streamedArtistLink,
  swipesChoose,
  ytDownloadActions,
  ytSongActions,
  ytSongCredit,
  type PlaylistPlace,
  type PlaylistSong,
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
import { currentPath, useCurrentPath } from "@/library/routes";
import { pressedMenuAllowed, pressedRect } from "@/motion/pressedRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { NO_SWIPE, type RowSwipe } from "@/catalog/SwipeableRow";
import { CardHeading } from "@/overlay/CardHeading";
import { MenuChoices, type MenuChoice, type PlayCardChoice } from "@/overlay/MenuChoices";
import { followUp, openOverlay } from "@/overlay/overlay";
import { addYtToQueue, playYtNext } from "@/playback/actions";
import type { MenuOptions } from "@/playback/ActionsMenu";
import { rowSwipe, swipeEntryNow, type RowSwipeOptions } from "@/playback/rowSwipe";
import { showError } from "@/overlay/alert";
import { useSwipeSettings } from "@/settings/swipeActions";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { shareStreamedSong } from "@/share/songShare";

import {
  currentLibraryFinder,
  knownLibraryFinder,
  useLibraryFinder,
  useLoadedInLibrary,
  type FindInLibrary,
} from "./libraryFinder";
import { openYtAlbum, ytAlbumPageHere } from "./routes";
import {
  libraryArtistsRead,
  streamedArtistContextNow,
  useStreamedArtistLink,
} from "./streamedArtist";
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
 * Retry Download while one is on its way or has failed. It opens once the
 * Library's artists are read, so Go to Artist is there from its first frame
 * (or, the read failing or slow, not at all: the menu never grows).
 */
export const openYtSongActions = (song: NativeYtSong, options: YtSongMenuOptions = {}): void => {
  const anchor = pressedRect();
  const allowed = pressedMenuAllowed();
  // The row stays highlighted meanwhile: the card opens inside the follow-up.
  void followUp(() =>
    libraryArtistsRead().then(() => {
      if (!allowed()) return;
      openOverlay({
        label: song.title,
        anchor,
        render: (close) => (
          <YtSongActionsMenu
            song={song}
            playlistItem={options.playlistItem}
            onSelect={options.onSelect}
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
        "playNext" | "addToQueue" | "addToPlaylist" | "removeFromPlaylist" | "share" | "select";
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

const label = (entry: Entry): string =>
  entry.kind === "download"
    ? YT_DOWNLOAD_ACTION_LABELS[entry.action]
    : ITEM_ACTION_LABELS[entry.action];

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
): void => {
  if (entry.kind === "album") {
    // The page heads with what the song knows of its album until the page is read.
    openYtAlbum(entry.album, { title: song.album ?? "", line: "", artworkUrl: song.artworkUrl });
    return;
  }
  if (entry.kind === "artist") {
    followStreamedArtistLink(entry.artists);
    return;
  }
  if (entry.kind === "star") {
    // A star means downloaded: the song joins the download queue with it.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void starSongs({ tracks: [], ytSongs: [song] }, entry.action === "favorite", find);
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
 * What swiping a YT Music [song]'s row runs (none for null, so a row of
 * several kinds can ask for each): its menu's entries (`rowSwipe`), run as
 * the menu runs them. A list mounts many rows, so it follows nothing but the
 * swipe settings: the route and the stars are read as it renders and again
 * as a swipe runs, and so, only while a direction is set to them, are its
 * artists (Go to Artist, once the Library's artists are read) and its
 * download's state (Download).
 */
export const useYtSongSwipe = (
  song: NativeYtSong | null,
  options: RowSwipeOptions = {},
): RowSwipe => {
  const settings = useSwipeSettings();
  const ytMusic = useYtMusicEnabled();
  const here = useCurrentPath(false);
  if (song === null || !settings.enabled) return NO_SWIPE;
  const { playlistItem } = options;
  const entriesWith = (find: FindInLibrary, at: string, inLibrary: boolean): Entry[] => {
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
  if (swipesChoose(settings, "goToArtist") && streamedArtistContextNow() === undefined)
    void libraryArtistsRead();
  // Download: until the Library is read, a song counts as in it, so Download never shows only to go away.
  const known = swipesChoose(settings, "download") ? knownLibraryFinder() : null;
  return rowSwipe(
    entriesWith(() => null, here, known === null || known(song) !== null).map(
      (entry) => entry.action,
    ),
    (_, side) => {
      Promise.all([
        currentLibraryFinder(),
        swipesChoose(settings, "goToArtist") ? libraryArtistsRead() : undefined,
      ])
        .then(([find]) => {
          const entry = swipeEntryNow(entriesWith(find, currentPath(), find(song) !== null), side);
          if (entry !== undefined) run(entry, song, { find, playlistItem, onSelect: undefined });
        })
        .catch((error: unknown) => showError("Couldn't load the song", error));
    },
    options,
  );
};

/**
 * The menu card: the song as its row shows it (unless that row is highlighted),
 * then its entries, like a Library song's menu.
 */
function YtSongActionsMenu({
  song,
  playlistItem,
  onSelect,
  close,
}: {
  song: NativeYtSong;
  playlistItem: PlaylistPlace | undefined;
  onSelect: (() => void) | undefined;
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
    }),
    ...ytDownloadActions(status, { inLibrary }).map((action): Entry => ({
      kind: "download",
      action,
    })),
  ];
  const choose = (entry: Entry) => () => {
    close();
    run(entry, song, { find, playlistItem, onSelect });
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
