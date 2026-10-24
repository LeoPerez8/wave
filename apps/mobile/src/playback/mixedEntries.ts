import { selectionEntries, type YtArtistAlbum } from "@wave/core";
import type { AlbumRow, SongRow } from "../library/LibraryStore.ts";
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
    readonly finder: () => Promise<FindInLibrary>;
  },
): Promise<readonly TargetEntry[]> =>
  selectionEntries<MixedItem, NativeYtSong, SongRow>(items, {
    entries: async (item) => {
      if (item.kind === "album")
        return (await ports.album(item.item)).map((track) => ({ source: "library", track }));
      if (item.kind === "ytAlbum")
        return (await ports.release(item.item)).map((song) => ({ source: "stream", song }));
      return [trackEntry(item.item)];
    },
    finder: ports.finder,
  });
