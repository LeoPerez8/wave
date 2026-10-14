import { router, type Href } from "expo-router";
import { useState } from "react";

/** What a Discover cover knew about the album or playlist it opens, for that screen's first frame. */
export interface YtListHead {
  readonly title: string;
  /** Who made it: the artists, or the playlist's maker. */
  readonly line: string;
  readonly artworkUrl: string | null;
}

export type YtListScreen = "yt-album" | "yt-playlist";

let opening:
  | { readonly screen: YtListScreen; readonly id: string; readonly head: YtListHead }
  | undefined;

const open = (screen: YtListScreen, id: string, head: YtListHead): void => {
  opening = { screen, id, head };
  router.push(`/library/${screen}/${encodeURIComponent(id)}` as Href);
};

/** Opens a YT Music album's songs (its `MPREb_…` page), on the Library stack. */
export const openYtAlbum = (browseId: string, head: YtListHead): void =>
  open("yt-album", browseId, head);

/** Opens a YT Music playlist's songs, on the Library stack. */
export const openYtPlaylist = (playlistId: string, head: YtListHead): void =>
  open("yt-playlist", playlistId, head);

/** What the tapped cover knew about [id], read once as its screen mounts. */
export const useYtListHead = (screen: YtListScreen, id: string): YtListHead | undefined => {
  const [head] = useState(() =>
    opening?.screen === screen && opening.id === id ? opening.head : undefined,
  );
  return head;
};

/**
 * Opens the YouTube Music artist page [browseId] (`UC…`), for an artist the
 * Library doesn't have, on the Library stack. [name], when the opener knows
 * it, heads the page until the artist's page has been read.
 */
export const openYtArtist = (browseId: string, name?: string): void => {
  const query = name === undefined || name === "" ? "" : `?name=${encodeURIComponent(name)}`;
  router.push(`/library/yt-artist/${encodeURIComponent(browseId)}${query}` as Href);
};

/** The YouTube Music artist page's id segment when it's opened by name, not by browse id. */
export const YT_ARTIST_BY_NAME = "by-name";

/**
 * Opens the YouTube Music artist page of the artist named [name], for an
 * artist the Library doesn't have whose browse id isn't known (a streamed
 * song's): the page finds them with an Artists search, as the Library artist
 * page does (Core's `pickYtArtist`).
 */
export const openYtArtistNamed = (name: string): void =>
  router.push(`/library/yt-artist/${YT_ARTIST_BY_NAME}?name=${encodeURIComponent(name)}` as Href);

/** Discover, on the Library stack. */
export const openDiscover = (): void => router.push("/library/discover" as Href);
