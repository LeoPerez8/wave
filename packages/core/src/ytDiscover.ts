/**
 * YT Music songs next to the Library's (docs/spec.md, "YT Music"): which play
 * from the Library's file rather than streamed, the id each goes by in the
 * queue, and an album page's songs. Search, artist, album and playlist pages
 * and Home's Discover mixes share them.
 */

import type { YtAlbum, YtAlbumTrack } from "./ytDownload.ts";
import { ytTrackId, type YtSong } from "./ytMusic.ts";

/** Something YouTube Music lists on a shelf (an artist page's albums): a song, an album or a playlist. */
export type YtShelfItem<S extends YtSong = YtSong> =
  | { readonly kind: "song"; readonly song: S }
  | {
      readonly kind: "album";
      /** The album's page (`MPREb_…`). */
      readonly browseId: string;
      readonly title: string;
      readonly artists: readonly string[];
      readonly year: number | null;
      readonly artworkUrl: string | null;
    }
  | {
      readonly kind: "playlist";
      /** The playlist's id, without the `VL` its page adds. */
      readonly playlistId: string;
      readonly title: string;
      /** Its line under the title, as YouTube Music writes it ("Owner • 1.2M views"). */
      readonly credit: string | null;
      readonly artworkUrl: string | null;
    };

/**
 * A YT Music song as Wave plays it: the Library's file when the Library
 * already has the song (Core's `libraryFinder`), else streamed.
 */
export type DiscoverSong<S extends YtSong = YtSong, L = unknown> =
  | { readonly source: "stream"; readonly song: S }
  | { readonly source: "library"; readonly song: S; readonly track: L };

const discoverSong = <S extends YtSong, L>(
  song: S,
  find: (song: S) => L | null,
): DiscoverSong<S, L> => {
  const track = find(song);
  return track === null ? { source: "stream", song } : { source: "library", song, track };
};

/** [songs] as Wave plays them: each from the Library's file when it has the song. */
export const discoverSongs = <S extends YtSong, L>(
  songs: readonly S[],
  find: (song: S) => L | null,
): DiscoverSong<S, L>[] => songs.map((song) => discoverSong(song, find));

/** A song on a YT Music album page, as its tracklist lists it. */
export interface YtAlbumPageTrack extends YtAlbumTrack {
  readonly artists: readonly string[];
  readonly durationMs: number | null;
  readonly explicit: boolean;
}

/** A YT Music song that knows its album's page. */
export interface YtAlbumSong extends YtSong {
  readonly albumId: string | null;
}

/**
 * The songs of the album page [browseId]: its tracks, on that album, with its
 * cover (the tracklist doesn't give each its own).
 */
export const ytAlbumSongs = (
  browseId: string,
  album: Omit<YtAlbum, "tracks"> & { readonly tracks: readonly YtAlbumPageTrack[] },
): YtAlbumSong[] =>
  album.tracks.map((track) => ({
    videoId: track.videoId,
    title: track.title,
    artists: track.artists,
    album: album.title,
    albumId: browseId,
    durationMs: track.durationMs,
    artworkUrl: album.artworkUrl,
    explicit: track.explicit,
  }));

/**
 * A song of a list that mixes the Library's files and YT Music songs (Search,
 * an artist's or an album's page with what YouTube Music has): a Library
 * song, or a YT Music song streamed.
 */
export type MixedSong<S extends YtSong = YtSong, L = unknown> =
  | { readonly source: "stream"; readonly song: S }
  | { readonly source: "library"; readonly track: L };

/** The id [song] goes by in the queue: its Library track's, or its YT Music id. */
export const discoverTrackId = <S extends YtSong>(
  song: MixedSong<S, { readonly id: number }>,
): string => (song.source === "library" ? String(song.track.id) : ytTrackId(song.song.videoId));
