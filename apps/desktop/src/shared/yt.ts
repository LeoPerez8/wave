/** YouTube Music as the window sees it (`window.wave.yt`). */
import {
  joinArtists,
  type YtAlbumSong,
  type YtArtistAlbum,
  type YtArtistCandidate,
} from "@wave/core";

import type { Page } from "./bridge.ts";
import type { BrowseRow } from "./browse.ts";

/** How a YouTube Music search went: its songs, artists and albums, or why there are none. */
export type YtStatus = "ok" | "offline" | "disabled" | "failed";

export interface YtSearchPage {
  readonly status: YtStatus;
  /** The songs, as rows with `videoId` and `artworkUrl` and no Library id. */
  readonly songs: Page<BrowseRow>;
  readonly artists: readonly YtArtistCandidate[];
  readonly albums: readonly YtArtistAlbum[];
  /**
   * What of the answer the Library already has (Core's `libraryFinder`, `libraryArtistFinder`
   * and `libraryReleaseFinder`): songs by video id, artists and albums by browse id.
   */
  readonly inLibrary: {
    readonly songs: readonly string[];
    readonly artists: readonly string[];
    readonly albums: readonly string[];
  };
}

/** A YT Music song as the window's rows show it: no Library id, its cover by address. */
export const ytRow = (song: YtAlbumSong): BrowseRow => ({
  id: 0,
  videoId: song.videoId,
  title: song.title,
  artist: joinArtists(song.artists),
  artists: song.artists,
  album: song.album ?? "",
  albumId: song.albumId ?? null,
  artworkHash: null,
  artworkUrl: song.artworkUrl,
  durationMs: song.durationMs ?? 0,
  count: 0,
  year: null,
  genre: null,
  trackNumber: null,
  favorite: false,
  path: null,
  unavailable: false,
});
