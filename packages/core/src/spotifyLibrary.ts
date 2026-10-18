/**
 * Importing playlists from the signed-in Spotify account (docs/spec.md,
 * "Importing playlists from a link", From Spotify; the research is
 * docs/spotify-account.md): reading the account's playlists and Liked Songs
 * through the web player's `libraryV3`, `fetchPlaylist` and
 * `fetchLibraryTracks` queries. The native module sends each query as the
 * account (`WaveSpotify`) and hands back its `data`; Core asks for the pages
 * and reads them.
 */

import { array, at, text } from "./json.ts";
import { SPOTIFY_CHANGED_LINE } from "./spotifyAccount.ts";
import {
  firstImage,
  readSpotifyPages,
  spotifyPlaylistPage,
  spotifyTrackSong,
  type SpotifyPlaylist,
  type SpotifySong,
} from "./spotifyPlaylist.ts";
import type { YtLibraryFailureView } from "./ytLibrary.ts";

/**
 * Why a query as the account didn't answer: offline, Spotify failed, no
 * session Spotify accepts, or Spotify changed its web player.
 */
export type SpotifyAccountFailure = "offline" | "failed" | "signedOut" | "changed";

/** A query's `data`, or why there wasn't one. */
export type SpotifyAccountAnswer =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly reason: SpotifyAccountFailure };

/**
 * Liked Songs' source: what the From Spotify picker, the batch and the
 * origins call the account's Liked Songs, read as a playlist.
 */
export const SPOTIFY_LIKED_SONGS_SOURCE = "spotify:collection";

const PLAYLIST_URI = /^spotify:playlist:[A-Za-z0-9]+$/u;

/**
 * Whether [source] (a From YT Music or From Spotify picker row, or a batch's
 * read) is a Spotify one: Liked Songs or a `spotify:playlist:<id>` URI. A
 * YouTube Music playlist id never has a colon.
 */
export const isSpotifyLibrarySource = (source: string): boolean =>
  source === SPOTIFY_LIKED_SONGS_SOURCE || PLAYLIST_URI.test(source);

const FAILURES: Record<SpotifyAccountFailure, YtLibraryFailureView> = {
  offline: { line: "You're offline. Try again when you're back online.", action: "tryAgain" },
  failed: { line: "Couldn't read your Spotify library. No answer online.", action: "tryAgain" },
  signedOut: {
    line: "Your Spotify session ended. Sign in again to see your playlists.",
    action: "signIn",
  },
  changed: { line: SPOTIFY_CHANGED_LINE, action: "tryAgain" },
};

/** The From Spotify picker's message for a library that wasn't read, and what it offers. */
export const spotifyLibraryFailure = (reason: SpotifyAccountFailure): YtLibraryFailureView =>
  FAILURES[reason];

/** A playlist in the account's library, as From Spotify lists it. */
export interface SpotifyLibraryPlaylist {
  /** `spotify:playlist:<id>`, or `SPOTIFY_LIKED_SONGS_SOURCE`. */
  readonly source: string;
  readonly title: string;
  readonly artworkUrl: string | null;
  /** How many songs Spotify says it has: only Liked Songs' count comes with the library. */
  readonly songCount: number | null;
}

/** What the library read gives: every playlist in Spotify's order, or why it couldn't. */
export type SpotifyLibraryRead =
  | { readonly ok: true; readonly playlists: readonly SpotifyLibraryPlaylist[] }
  | { readonly ok: false; readonly reason: SpotifyAccountFailure };

/** A `libraryV3` entry as a playlist; null for a folder, an unavailable playlist or Your Episodes. */
const libraryPlaylist = (entry: unknown): SpotifyLibraryPlaylist | null => {
  const wrapper = at(entry, "item");
  const data = at(wrapper, "data");
  switch (text(at(wrapper, "__typename"))) {
    case "LibraryPseudoPlaylistResponseWrapper": {
      if (text(at(data, "__typename")) !== "PseudoPlaylist") return null;
      const count = at(data, "count");
      return {
        source: SPOTIFY_LIKED_SONGS_SOURCE,
        title: "Liked Songs",
        artworkUrl: firstImage(at(data, "image", "sources")),
        songCount: typeof count === "number" && Number.isSafeInteger(count) ? count : null,
      };
    }
    case "PlaylistResponseWrapper": {
      const uri = text(at(data, "uri"));
      if (text(at(data, "__typename")) !== "Playlist" || at(data, "revisionId") == null) {
        return null;
      }
      if (uri === null || !PLAYLIST_URI.test(uri)) return null;
      return {
        source: uri,
        title: text(at(data, "name")) ?? "",
        artworkUrl: firstImage(at(array(at(data, "images", "items"))[0], "sources")),
        songCount: null,
      };
    }
    default:
      return null;
  }
};

/**
 * Reads the account's library through [ask] (one `libraryV3` page per
 * offset, playlists only, folders flattened, Liked Songs included): every
 * playlist it lists, created and followed, and Liked Songs, in Spotify's
 * order. Folders, playlists Spotify no longer has and Your Episodes are left
 * out. A page that fails fails the read with its reason; one that isn't a
 * library page is `failed`.
 */
export const readSpotifyLibrary = async (
  ask: (offset: number) => Promise<SpotifyAccountAnswer>,
): Promise<SpotifyLibraryRead> => {
  const playlists: SpotifyLibraryPlaylist[] = [];
  return readSpotifyPages<SpotifyLibraryRead>(
    async (offset) => {
      const answer = await ask(offset);
      if (!answer.ok) return { done: answer };
      const page = at(answer.data, "me", "libraryV3");
      const items = at(page, "items");
      const total = at(page, "totalCount");
      if (!Array.isArray(items) || typeof total !== "number")
        return { done: { ok: false, reason: "failed" } };
      for (const item of items) {
        const playlist = libraryPlaylist(item);
        if (playlist !== null) playlists.push(playlist);
      }
      return { items: items.length, total };
    },
    () => ({ ok: true, playlists }),
  );
};

/**
 * One page the native module is asked for: a playlist's `fetchPlaylist`
 * page, or a `fetchLibraryTracks` page of Liked Songs, from [offset].
 */
export type SpotifyAccountRequest =
  | { readonly kind: "playlist"; readonly uri: string; readonly offset: number }
  | { readonly kind: "likedSongs"; readonly offset: number };

/** What reading a playlist as the account gives, or why it couldn't (`missing`: Spotify no longer has it). */
export type SpotifyAccountRead =
  | { readonly ok: true; readonly playlist: SpotifyPlaylist }
  | { readonly ok: false; readonly reason: SpotifyAccountFailure | "missing" };

interface Page {
  readonly title: string;
  readonly artworkUrl: string | null;
  readonly total: number;
  readonly items: number;
  readonly songs: readonly SpotifySong[];
}

const LIKED_SONGS = "Liked Songs";

/** A `fetchLibraryTracks` answer's page of Liked Songs; null when it isn't one. */
const likedSongsPage = (data: unknown): Page | null => {
  const tracks = at(data, "me", "library", "tracks");
  const items = at(tracks, "items");
  const total = at(tracks, "totalCount");
  if (!Array.isArray(items) || typeof total !== "number") return null;
  return {
    title: LIKED_SONGS,
    artworkUrl: null,
    total,
    items: items.length,
    songs: items
      .map((item) => spotifyTrackSong(at(item, "track", "data")))
      .filter((song) => song !== null),
  };
};

/**
 * Reads [source] (a `spotify:playlist:<id>` URI, or Liked Songs) as the
 * account through [ask], page by page, with no song limit: the account's
 * private and collaborative playlists read too. Liked Songs reads as a
 * playlist named "Liked Songs", with no cover. A song Spotify no longer has,
 * or an episode, counts in the total but isn't listed. A page that fails
 * fails the read with its reason; a playlist Spotify no longer has is
 * `missing`; an answer Wave can't read is `failed`.
 */
export const readSpotifyAccountPlaylist = async (
  source: string,
  ask: (request: SpotifyAccountRequest) => Promise<SpotifyAccountAnswer>,
): Promise<SpotifyAccountRead> => {
  const liked = source === SPOTIFY_LIKED_SONGS_SOURCE;
  const songs: SpotifySong[] = [];
  let first: Page | null = null;
  let last: Page | null = null;
  return readSpotifyPages<SpotifyAccountRead>(
    async (offset) => {
      const answer = await ask(
        liked ? { kind: "likedSongs", offset } : { kind: "playlist", uri: source, offset },
      );
      if (!answer.ok) return { done: answer };
      const page = liked ? likedSongsPage(answer.data) : spotifyPlaylistPage({ data: answer.data });
      if (page === "notFound") return { done: { ok: false, reason: "missing" } };
      if (page === null) return { done: { ok: false, reason: "failed" } };
      first ??= page;
      last = page;
      songs.push(...page.songs);
      return page;
    },
    () => {
      if (first === null || last === null) return { ok: false, reason: "failed" };
      const { title, artworkUrl } = first;
      return {
        ok: true,
        playlist: { title, artworkUrl, songs, truncated: false, total: last.total },
      };
    },
  );
};
