/**
 * Reading a YT Music playlist (docs/spec.md, "YT Music"): YouTube Music sends
 * it a hundred rows a page, each page ending with the token for the next. The
 * native module reads one page at a time; Core follows the pages, keeps each
 * song once and stops at the cap. The import reads it all or fails; Discover
 * shows each page as it comes and keeps what it has when a later page fails.
 */

import type { YtSong } from "./ytMusic.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/** A page of a playlist's songs, and the token for the next page (null on the last). */
export interface YtPlaylistPage<S extends YtSong = YtSong> {
  readonly songs: readonly S[];
  readonly continuation: string | null;
}

/** A playlist's first page: its head as well as its songs. */
export interface YtPlaylistFirstPage<S extends YtSong = YtSong> extends YtPlaylistPage<S> {
  readonly title: string;
  /** Who made it ("YouTube Music" for its own mixes), when the page says. */
  readonly author: string | null;
  readonly artworkUrl: string | null;
}

/** A YT Music playlist as read: its head and its songs, in YouTube Music's order, each once. */
export interface YtPlaylist<S extends YtSong = YtSong> {
  readonly title: string;
  readonly author: string | null;
  readonly artworkUrl: string | null;
  readonly songs: readonly S[];
  /** The rows that list one of [songs] again, in their order: each is kept once, at its first place. */
  readonly repeats: readonly S[];
  /** The playlist goes on past [songs]: the read stopped at its cap. */
  readonly truncated: boolean;
}

/** The most songs a read keeps: fifty full pages. */
export const YT_PLAYLIST_SONG_CAP = 5000;

/**
 * The most pages a read asks for, the first included. This leaves room for
 * rows YouTube Music greys out while keeping a playlist whose pages never end
 * from reading forever.
 */
export const YT_PLAYLIST_PAGE_CAP = 100;

export interface YtPlaylistReadOptions<S extends YtSong> {
  /** Hears the playlist after each page, and whether that was the last one asked for. */
  readonly onPage?: (playlist: YtPlaylist<S>, done: boolean) => void;
  /** Once aborted, no more page is asked for and the read rejects. */
  readonly signal?: AbortSignal;
  /**
   * Reads past `YT_PLAYLIST_SONG_CAP` and `YT_PLAYLIST_PAGE_CAP` to the last
   * page (Liked Songs). A token already followed, or a page of nothing but
   * songs already read, still ends it, so pages that never end can't read forever.
   */
  readonly uncapped?: boolean;
}

/**
 * Reads a whole playlist: its first page ([first]), then each page its token
 * leads to ([more]) until the last, `YT_PLAYLIST_SONG_CAP` songs or
 * `YT_PLAYLIST_PAGE_CAP` pages, whichever comes first (`truncated` then says
 * so), or, `uncapped`, until the last. A song listed twice is kept once, at
 * its first place. A page that fails rejects the whole read, so it never resolves with part of a playlist
 * that looks complete; [onPage] has heard the pages before it.
 */
export const readYtPlaylist = async <S extends YtSong>(
  first: () => Promise<YtPlaylistFirstPage<S>>,
  more: (continuation: string) => Promise<YtPlaylistPage<S>>,
  options: YtPlaylistReadOptions<S> = {},
): Promise<YtPlaylist<S>> => {
  const { onPage, signal, uncapped = false } = options;
  const songCap = uncapped ? Infinity : YT_PLAYLIST_SONG_CAP;
  const head = await first();
  const songs = new Map<string, S>();
  const repeats: S[] = [];
  const followed = new Set<string>();
  let page: YtPlaylistPage<S> = head;
  for (let pages = 1; ; pages++) {
    const before = songs.size;
    for (const song of page.songs) {
      if (songs.has(song.videoId)) repeats.push(song);
      else songs.set(song.videoId, song);
    }
    const full = uncapped
      ? (page.songs.length > 0 && songs.size === before) ||
        (page.continuation !== null && followed.has(page.continuation))
      : songs.size >= YT_PLAYLIST_SONG_CAP || pages >= YT_PLAYLIST_PAGE_CAP;
    const next = full ? null : page.continuation;
    const kept = [...songs.values()].slice(0, songCap);
    const keptIds = new Set(kept.map((song) => song.videoId));
    const playlist: YtPlaylist<S> = {
      title: head.title,
      author: head.author,
      artworkUrl: head.artworkUrl,
      songs: kept,
      repeats: repeats.filter((song) => keptIds.has(song.videoId)),
      truncated: songs.size > songCap || (full && page.continuation !== null),
    };
    onPage?.(playlist, next === null);
    if (next === null) return playlist;
    if (signal?.aborted === true) throw new Error("The playlist read was cancelled");
    followed.add(next);
    page = await more(next);
  }
};

/**
 * How the rest of a playlist shown while it's read stands: pages still
 * coming, every page in, or a later page failed (offline, or YouTube failed).
 */
export type YtPlaylistRest = "reading" | "read" | YtQuietReason;

/**
 * The line under a playlist's songs on Discover while the rest is read, or
 * when it couldn't be: the songs above stay and play either way. Null once
 * every page is in.
 */
export const ytPlaylistRestLine = (rest: YtPlaylistRest): string | null => {
  switch (rest) {
    case "reading":
      return "Loading more songs…";
    case "read":
      return null;
    case "offline":
      return "You're offline, so the rest of this playlist didn't load.";
    case "failed":
      return "The rest of this playlist didn't load. Go back and open it again to try once more.";
  }
};
