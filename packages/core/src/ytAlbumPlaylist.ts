/**
 * Opening a YouTube Music album's playlist link (`OLAK5uy_…`; docs/spec.md,
 * "Opening a song link"): it opens as the album page its songs name. The
 * playlist is read through the app's YT Music service; Core decides.
 */

import type { AlbumLinkFailure, ServiceAlbum } from "./spotifyAlbum.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/** A YouTube Music album playlist's first page as read, or why it wasn't. */
export type YtAlbumPlaylistRead =
  | {
      readonly ok: true;
      readonly playlist: {
        readonly title: string;
        /** Who made it, as the page says: an album's artist. */
        readonly author: string | null;
        readonly artworkUrl: string | null;
        /** Its songs, each with the album page it names (`MPREb_…`), when it names one. */
        readonly songs: readonly { readonly albumId?: string | null }[];
      };
    }
  | { readonly ok: false; readonly reason: YtQuietReason | "disabled" };

/**
 * The YT Music album an album's playlist (`OLAK5uy_…`) opens on: the album
 * page its songs name ([read], its first page), the one most of them name,
 * headed by the playlist's title, maker and cover until that page is read.
 * Songs that name no album aren't found as one (`albumNotFound`); no answer
 * says why (`albumOffline`, `disabled`, `failed`).
 */
export const ytAlbumPlaylistOpening = async (
  read: () => Promise<YtAlbumPlaylistRead>,
): Promise<{ readonly album: string; readonly read: ServiceAlbum } | AlbumLinkFailure> => {
  const page = await read();
  if (!page.ok)
    return {
      play: "failed",
      failure: page.reason === "offline" ? "albumOffline" : page.reason,
    };
  const { title, author, artworkUrl, songs } = page.playlist;
  const artists = author === null ? [] : [author];
  const counts = new Map<string, number>();
  for (const song of songs)
    if (song.albumId != null) counts.set(song.albumId, (counts.get(song.albumId) ?? 0) + 1);
  let album: string | null = null;
  let most = 0;
  for (const [id, count] of counts)
    if (count > most) {
      album = id;
      most = count;
    }
  return album === null
    ? { play: "failed", failure: { albumNotFound: { title, artists } } }
    : { album, read: { title, artists, artworkUrl } };
};
