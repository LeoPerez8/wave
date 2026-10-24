import { groupSongs, queueSongTrackId, type YtArtistAlbum } from "@wave/core";
import type { AlbumRow, SongRow } from "../library/LibraryStore";
import type { NativeYtSong } from "../native/waveYtMusic";
import type { FindInLibrary } from "../ytmusic/libraryFinder";
import type { TargetEntry } from "./actionTargets";
import type { MixedItem } from "./mixedItems";

/** Called by an action, never by selection or bar planning. */
export const resolveMixedEntries = async (
  items: readonly MixedItem[],
  ports: {
    readonly album: (album: AlbumRow) => Promise<readonly SongRow[]>;
    readonly release: (album: YtArtistAlbum) => Promise<readonly NativeYtSong[]>;
    readonly finder: () => Promise<FindInLibrary>;
  },
): Promise<readonly TargetEntry[]> => {
  const lists = await Promise.all(
    items.map(async (item): Promise<readonly TargetEntry[]> => {
      if (item.kind === "album")
        return (await ports.album(item.item)).map((track) => ({ source: "library", track }));
      if (item.kind === "ytAlbum")
        return (await ports.release(item.item)).map((song) => ({ source: "stream", song }));
      const track = item.item;
      return [
        "song" in track
          ? { source: "library", track: track.song }
          : "unsearched" in track
            ? { source: "unsearched", song: track.unsearched }
            : { source: "stream", song: track.ytSong },
      ];
    }),
  );
  const find = lists.some((list) => list.some((entry) => entry.source === "stream"))
    ? await ports.finder()
    : () => null;
  return groupSongs(
    lists.map((list) =>
      list.map((entry): TargetEntry => {
        const track = entry.source === "stream" ? find(entry.song) : null;
        return track?.path == null ? entry : { source: "library", track };
      }),
    ),
    queueSongTrackId,
  );
};
