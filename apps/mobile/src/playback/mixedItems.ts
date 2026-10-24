import {
  commonKind,
  unsearchedTrackId,
  type MixedSong,
  type QueueSong,
  type YtArtistAlbum,
  type YtArtistShelf,
} from "@wave/core";
import type { AlbumRow, SongRow } from "../library/LibraryStore.ts";
import type { NativeYtSong } from "../native/waveYtMusic.ts";
import type { ActionItems, TrackItem } from "./actionTargets.ts";

/** Shelf releases and songs carry only the metadata already shown on the page. */
export type MixedItem =
  | { readonly kind: "track"; readonly item: TrackItem }
  | { readonly kind: "album"; readonly item: AlbumRow }
  | { readonly kind: "ytAlbum"; readonly item: YtArtistAlbum };

export const albumItem = (item: AlbumRow): MixedItem => ({ kind: "album", item });
export const ytAlbumItem = (item: YtArtistAlbum): MixedItem => ({ kind: "ytAlbum", item });
export const trackItem = (song: SongRow): MixedItem => ({ kind: "track", item: { song } });
export const ytTrackItem = (ytSong: NativeYtSong): MixedItem => ({
  kind: "track",
  item: { ytSong },
});

/** A song's selection key follows the song, independently of its page position. */
export const trackItemKey = (item: TrackItem): string =>
  "song" in item
    ? String(item.song.id)
    : "unsearched" in item
      ? unsearchedTrackId(item.unsearched)
      : `yt:${item.ytSong.videoId}`;

/** A checked song as an action takes it: the Library's, an unsearched entry, or streamed. */
export const trackEntry = (item: TrackItem): QueueSong<NativeYtSong, SongRow> =>
  "song" in item
    ? { source: "library", track: item.song }
    : "unsearched" in item
      ? { source: "unsearched", song: item.unsearched }
      : { source: "stream", song: item.ytSong };

export const mixedItemKey = (item: MixedItem): string =>
  item.kind === "album"
    ? `album-${item.item.id}`
    : item.kind === "ytAlbum"
      ? `yt-album-${item.item.browseId}`
      : `track-${trackItemKey(item.item)}`;

/** Homogeneous Library items keep their actions; streamed releases share the mixed bar. */
export const mixedTarget = (items: readonly MixedItem[]): ActionItems => {
  if (items.some((item) => item.kind === "ytAlbum"))
    return { kind: "mixed", items, readOnAction: true };
  const kind = commonKind(items.map((item) => (item.kind === "track" ? "track" : "album")));
  if (kind === "track")
    return { kind, items: items.flatMap((item) => (item.kind === "track" ? [item.item] : [])) };
  if (kind === "album")
    return { kind, items: items.flatMap((item) => (item.kind === "album" ? [item.item] : [])) };
  return { kind: "mixed", items };
};

/** Shelf order, then song order, without expanding any release or matching any song. */
export const artistSelectionItems = (
  shelves: readonly YtArtistShelf<AlbumRow>[],
  songs: readonly MixedSong<NativeYtSong, SongRow>[],
): MixedItem[] => [
  ...shelves.flatMap((shelf) =>
    shelf.releases.map(({ album, library }) =>
      library === null ? ytAlbumItem(album) : albumItem(library),
    ),
  ),
  ...songs.map((song) =>
    song.source === "library" ? trackItem(song.track) : ytTrackItem(song.song),
  ),
];

export const artistSelectionTarget = (items: readonly MixedItem[]): ActionItems => ({
  ...mixedTarget(items),
  readOnAction: true,
});
