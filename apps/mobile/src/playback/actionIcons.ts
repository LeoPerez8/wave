import {
  IconArrowForwardUp,
  IconArrowsShuffle,
  IconDeviceFloppy,
  IconDisc,
  IconDownload,
  IconListCheck,
  IconMicrophone2,
  IconMusicSearch,
  IconPencil,
  IconPhotoEdit,
  IconPhotoOff,
  IconPlayerPlay,
  IconPlaylistAdd,
  IconPlaylistX,
  IconRefresh,
  IconRowInsertBottom,
  IconSearch,
  IconShare3,
  IconSparkles,
  IconStar,
  IconStarOff,
  IconTrash,
  IconTrashX,
  IconX,
} from "@tabler/icons-react-native";
import type {
  DiscoverMixAction,
  ItemAction,
  PlayAction,
  UnavailableEntryAction,
  YtAlbumDownloadAction,
  YtPlaylistDownloadAction,
} from "@wave/core";
import type { ComponentType } from "react";

/** What a Tabler line icon takes. */
export type ActionIconProps = { size?: number; color?: string; strokeWidth?: number };

/** A Tabler line icon component. */
export type ActionIcon = ComponentType<ActionIconProps>;

/**
 * Every entry a long-press menu or the selection bar can offer: the Library's
 * item actions, a YT Music album's, a playlist's and a Discover mix's
 * entries, an unavailable entry's, and the play cards and Shuffle row.
 */
export type MenuAction =
  | ItemAction
  | PlayAction
  | YtAlbumDownloadAction
  | YtPlaylistDownloadAction
  | DiscoverMixAction
  | UnavailableEntryAction;

/**
 * Each action's one icon, the same in every menu that offers it and on the
 * selection bar: a download is the download arrow whether it's a song's, an
 * album's, a playlist's or a mix's, a cancel the X, a retry the circling arrows.
 */
export const ACTION_ICONS: { readonly [A in MenuAction]: ActionIcon } = {
  play: IconPlayerPlay,
  shuffle: IconArrowsShuffle,
  playNext: IconArrowForwardUp,
  addToQueue: IconRowInsertBottom,
  magicQueue: IconSparkles,
  addToPlaylist: IconPlaylistAdd,
  favorite: IconStar,
  unfavorite: IconStarOff,
  removeFromPlaylist: IconPlaylistX,
  goToAlbum: IconDisc,
  goToArtist: IconMicrophone2,
  renamePlaylist: IconPencil,
  changeImage: IconPhotoEdit,
  removeImage: IconPhotoOff,
  deletePlaylist: IconTrash,
  deletePlaylists: IconTrash,
  fixSong: IconMusicSearch,
  fixSongs: IconMusicSearch,
  select: IconListCheck,
  delete: IconTrash,
  removeFromLibrary: IconTrashX,
  download: IconDownload,
  cancelDownload: IconX,
  retryDownload: IconRefresh,
  downloadMissingSongs: IconDownload,
  retryFailed: IconRefresh,
  downloadAlbum: IconDownload,
  cancelAlbumDownload: IconX,
  downloadPlaylist: IconDownload,
  cancelPlaylistDownload: IconX,
  saveAsPlaylist: IconDeviceFloppy,
  search: IconSearch,
  share: IconShare3,
};
