import { en, type Catalogue } from "./catalogueEn.ts";
import { discoverMixCaption } from "./discoverMixes.ts";
import type { BlendedDiscoverMix } from "./discoverMixLevels.ts";
import { importedPlaylistName } from "./m3u.ts";
import type { PlaylistSong } from "./playlistEntries.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import type { YtAlbumDownload, YtAlbumDownloadAction } from "./ytSongsDownload.ts";

/** A cached Discover mix uses the album's download commands with its own menu labels. */
export type DiscoverMixAction =
  "playNext" | "addToQueue" | "saveAsPlaylist" | YtAlbumDownloadAction;


/** The mix's menu, following the same download batch as its page. */
export const discoverMixActions = (
  download: Pick<YtAlbumDownload, "actions">,
  catalogue: Catalogue = en,
): { readonly action: DiscoverMixAction; readonly label: string }[] => {
  const actions: DiscoverMixAction[] = [
    "playNext",
    "addToQueue",
    "saveAsPlaylist",
    ...download.actions,
  ];
  return actions.map((action) => ({ action, label: ({ playNext: catalogue.home.playNext, addToQueue: catalogue.home.addToQueue, saveAsPlaylist: catalogue.home.saveAsPlaylist, downloadAlbum: catalogue.home.downloadMix, cancelAlbumDownload: catalogue.home.cancelDownload, retryFailed: catalogue.home.retryFailed })[action] }));
};

/**
 * A one-time playlist copy of the mix as the owner's level blends it, in its
 * order: its Library songs as Library entries, its new ones as YT Music entries.
 */
export const discoverMixPlaylist = (
  mix: BlendedDiscoverMix,
  catalogue: Catalogue = en,
): { readonly name: string; readonly songs: readonly PlaylistSong<YtAlbumSong>[] } => ({
  name: importedPlaylistName(discoverMixCaption(mix, catalogue).title),
  songs: mix.songs.map((song) =>
    song.source === "stream"
      ? { source: "stream", song: song.song }
      : { source: "library", trackId: song.track.id },
  ),
});
