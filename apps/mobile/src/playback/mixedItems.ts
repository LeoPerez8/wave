import {
  commonKind,
  unsearchedTrackId,
  type MixedSong,
  type YtArtistAlbum,
  type YtArtistShelf,
} from "@wave/core";
import type { AlbumRow, SongRow } from "../library/LibraryStore";
import type { NativeYtSong } from "../native/waveYtMusic";
import type { ActionItems, TrackItem } from "./actionTargets";

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
  const kind = commonKind(items.map((item) => (item.kind === "ytAlbum" ? "album" : item.kind)));
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
