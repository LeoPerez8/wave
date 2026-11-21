/**
 * From Spotify on the desktop (docs/spec-desktop.md): the account's library
 * and playlists as Spotify's official Web API answers them, where the phone
 * reads the web player's queries (`spotifyLibrary.ts`). The desktop's main
 * process sends each request as the account and hands back its JSON; Core
 * says which paths to ask for and reads the pages. Both give the same
 * `SpotifyLibraryRead` and `SpotifyAccountRead`, so the picker, the matching
 * and the playlist's entries are the phone's.
 */

import { array, at, positive, text } from "./json.ts";
import {
  SPOTIFY_LIKED_SONGS_SOURCE,
  type SpotifyAccountAnswer,
  type SpotifyAccountRead,
  type SpotifyLibraryPlaylist,
  type SpotifyLibraryRead,
} from "./spotifyLibrary.ts";
import type { SpotifySong } from "./spotifyPlaylist.ts";

/** A Web API request's JSON, or why there wasn't one (`missing`: Spotify has no such playlist). */
export type SpotifyWebAnswer =
  SpotifyAccountAnswer | { readonly ok: false; readonly reason: "missing" };

/** Asks the Web API for [path] (`/v1/…` with its query) as the account. */
export type SpotifyWebAsk = (path: string) => Promise<SpotifyWebAnswer>;

const API_ORIGIN = "https://api.spotify.com";
const PAGE = 50;
const LIKED_SONGS = "Liked Songs";
const LIKED_PATH = "/v1/me/tracks";
const PLAYLISTS_PATH = "/v1/me/playlists";
const PLAYLIST_SOURCE = /^spotify:playlist:([A-Za-z0-9]+)$/u;

type WebFailure = Exclude<SpotifyWebAnswer, { ok: true }>["reason"];

type PagesEnd =
  | { readonly ok: true; readonly total: number }
  | { readonly ok: false; readonly reason: WebFailure };

/**
 * Reads a Web API list from [pathname], 50 items a page, following each
 * page's `next` until there is none. A `next` that leaves [pathname] on
 * Spotify's API, or names a page already read, isn't followed: the read
 * fails. [page] hears each page's items; the end gives Spotify's total.
 */
const readPages = async (
  ask: SpotifyWebAsk,
  pathname: string,
  page: (items: readonly unknown[], total: number) => void,
): Promise<PagesEnd> => {
  const asked = new Set<string>();
  let path = `${pathname}?limit=${PAGE}&offset=0`;
  for (;;) {
    asked.add(path);
    const answer = await ask(path);
    if (!answer.ok) return answer;
    const items = at(answer.data, "items");
    const total = at(answer.data, "total");
    if (!Array.isArray(items) || typeof total !== "number") return { ok: false, reason: "failed" };
    page(items, total);
    const next = at(answer.data, "next");
    if (next === null || next === undefined) return { ok: true, total };
    const url = typeof next === "string" && URL.canParse(next) ? new URL(next) : null;
    if (url === null || url.origin !== API_ORIGIN || url.pathname !== pathname)
      return { ok: false, reason: "failed" };
    path = `${url.pathname}${url.search}`;
    if (asked.has(path)) return { ok: false, reason: "failed" };
  }
};

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** The first image's address of a Web API `images` list. */
const firstImageUrl = (images: unknown): string | null =>
  array(images)
    .map((image) => text(at(image, "url")))
    .find((url) => url !== null) ?? null;

/** A playlist of `/v1/me/playlists`; null for an entry Spotify left empty. */
const libraryPlaylist = (entry: unknown): SpotifyLibraryPlaylist | null => {
  const id = text(at(entry, "id"));
  if (id === null || !PLAYLIST_SOURCE.test(`spotify:playlist:${id}`)) return null;
  return {
    source: `spotify:playlist:${id}`,
    title: text(at(entry, "name")) ?? "",
    artworkUrl: firstImageUrl(at(entry, "images")),
    // `items` since Spotify's February 2026 changes, `tracks` before them.
    songCount: count(at(entry, "items", "total")) ?? count(at(entry, "tracks", "total")),
  };
};

/**
 * Reads the account's library through [ask]: Liked Songs with how many songs
 * it has, then every playlist the account made or follows, in Spotify's
 * order. A request that fails fails the read with its reason; an answer
 * that isn't a list of playlists is `failed`. Liked Songs' count is left
 * out when Spotify's answer doesn't give one.
 */
export const readSpotifyWebLibrary = async (ask: SpotifyWebAsk): Promise<SpotifyLibraryRead> => {
  const failed = (reason: WebFailure): SpotifyLibraryRead => ({
    ok: false,
    reason: reason === "missing" ? "failed" : reason,
  });
  const liked = await ask(`${LIKED_PATH}?limit=1`);
  if (!liked.ok) return failed(liked.reason);
  const playlists: SpotifyLibraryPlaylist[] = [
    {
      source: SPOTIFY_LIKED_SONGS_SOURCE,
      title: LIKED_SONGS,
      artworkUrl: null,
      songCount: count(at(liked.data, "total")),
    },
  ];
  const end = await readPages(ask, PLAYLISTS_PATH, (items) => {
    for (const item of items) {
      const playlist = libraryPlaylist(item);
      if (playlist !== null) playlists.push(playlist);
    }
  });
  return end.ok ? { ok: true, playlists } : failed(end.reason);
};

/**
 * A playlist item's or a saved track's song, or null when it isn't one: an
 * episode, or an item Spotify no longer has. A local file has no artist and
 * no album, as the phone reads it.
 */
const webSong = (item: unknown): SpotifySong | null => {
  // `item` since Spotify's February 2026 changes, `track` before them and for saved tracks.
  const track = at(item, "item") ?? at(item, "track");
  if (text(at(track, "type")) !== "track") return null;
  const title = text(at(track, "name"));
  if (title === null) return null;
  const artworkUrl = firstImageUrl(at(track, "album", "images"));
  const song: SpotifySong = {
    title,
    artists: array(at(track, "artists"))
      .map((artist) => text(at(artist, "name")))
      .filter((name) => name !== null),
    album: text(at(track, "album", "name")),
    durationMs: positive(at(track, "duration_ms")),
  };
  return artworkUrl === null ? song : { ...song, artworkUrl };
};

/**
 * Reads [playlist] (a picker row's source, with the title it showed) through
 * [ask], whole and in Spotify's order: Liked Songs from the saved tracks,
 * any other from the playlist's items. An episode or an item Spotify no
 * longer has counts in the total but isn't listed. A request that fails
 * fails the read with its reason (`missing` when Spotify has no such
 * playlist); an answer Wave can't read, or a source that isn't Spotify's, is
 * `failed`. [onPage] hears how many items have been read and Spotify's total.
 */
export const readSpotifyWebPlaylist = async (
  playlist: { readonly source: string; readonly title: string },
  ask: SpotifyWebAsk,
  onPage?: (read: number, total: number) => void,
): Promise<SpotifyAccountRead> => {
  const id = PLAYLIST_SOURCE.exec(playlist.source)?.[1];
  const pathname =
    playlist.source === SPOTIFY_LIKED_SONGS_SOURCE
      ? LIKED_PATH
      : id === undefined
        ? null
        : `/v1/playlists/${id}/items`;
  if (pathname === null) return { ok: false, reason: "failed" };
  const songs: SpotifySong[] = [];
  let read = 0;
  const end = await readPages(ask, pathname, (items, total) => {
    for (const item of items) {
      const song = webSong(item);
      if (song !== null) songs.push(song);
    }
    read += items.length;
    onPage?.(read, total);
  });
  if (!end.ok) return end;
  return {
    ok: true,
    playlist: {
      title: playlist.title,
      artworkUrl: null,
      songs,
      truncated: false,
      total: end.total,
    },
  };
};
