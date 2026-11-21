import { selectionEntries, type YtArtistAlbum } from "@wave/core";
import type { AlbumRow, PlaylistRow, SongRow } from "@wave/client";
import type { OnlineAlbum } from "@wave/client/db/playedEntities";
import type { BlendedDiscoverMix } from "@wave/core";
import type { NativeYtSong } from "../native/waveYtMusic.ts";
import type { FindInLibrary } from "../ytmusic/libraryFinder.ts";
import type { TargetEntry } from "./actionTargets.ts";
import { trackEntry, type MixedItem } from "./mixedItems.ts";

/**
 * The checked albums, releases and songs as a bar action reads them, once it
 * runs (Core's `selectionEntries`): a Library album's songs, a streamed
 * release's tracklist, a song as it is.
 */
export const resolveMixedEntries = (
  items: readonly MixedItem[],
  ports: {
    readonly album: (album: AlbumRow) => Promise<readonly SongRow[]>;
    readonly release: (album: YtArtistAlbum) => Promise<readonly NativeYtSong[]>;
    readonly onlineAlbum?: (album: OnlineAlbum) => Promise<readonly NativeYtSong[]>;
    readonly playlist?: (playlist: PlaylistRow) => Promise<readonly TargetEntry[]>;
    readonly discoverMix?: (mix: BlendedDiscoverMix) => Promise<readonly TargetEntry[]>;
    readonly followRelease?: (
      item: Extract<MixedItem, { readonly kind: "followRelease" }>["item"],
    ) => Promise<readonly TargetEntry[]>;
    readonly ytPlaylist?: (
      playlist: Extract<MixedItem, { readonly kind: "ytPlaylist" }>["item"],
    ) => Promise<readonly NativeYtSong[]>;
    readonly finder: () => Promise<FindInLibrary>;
  },
): Promise<readonly TargetEntry[]> =>
  selectionEntries<MixedItem, NativeYtSong, SongRow>(items, {
    entries: async (item) => {
      if (item.kind === "album")
        return (await ports.album(item.item)).map((track) => ({ source: "library", track }));
      if (item.kind === "ytAlbum")
        return (await ports.release(item.item)).map((song) => ({ source: "stream", song }));
      if (item.kind === "onlineAlbum")
        return ((await ports.onlineAlbum?.(item.item)) ?? []).map((song) => ({
          source: "stream",
          song,
        }));
      if (item.kind === "playlist") return (await ports.playlist?.(item.item)) ?? [];
      if (item.kind === "discoverMix") return (await ports.discoverMix?.(item.item)) ?? [];
      if (item.kind === "followRelease") return (await ports.followRelease?.(item.item)) ?? [];
      if (item.kind === "ytPlaylist")
        return ((await ports.ytPlaylist?.(item.item)) ?? []).map((song) => ({
          source: "stream",
          song,
        }));
      return [trackEntry(item.item)];
    },
    finder: ports.finder,
  });
