/**
 * Opening an album link (docs/spec.md, "Opening a song link"). A Spotify
 * album's embed page (`open.spotify.com/embed/album/<id>`) gives its title,
 * artists and cover without an account or key, and one YT Music Albums search
 * finds the same album to open. A YouTube Music album's playlist
 * (`OLAK5uy_…`) opens as the album its songs name. The requests go through
 * the app's transport; Core builds and reads them.
 */

import { at, text } from "./json.ts";
import type { TrackReadFailure } from "./serviceTrack.ts";
import type { SongLinkFailure } from "./songLinkOpening.ts";
import { embedPageProps, embedRequest, type SpotifyTransport } from "./spotifyPlaylist.ts";
import { largestImage } from "./spotifyTrack.ts";
import { pickStreamedAlbum } from "./streamedCredits.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/** An album as its service's page describes it. */
export interface ServiceAlbum {
  readonly title: string;
  /** Its artists, in the service's order. */
  readonly artists: readonly string[];
  readonly artworkUrl: string | null;
}

/** An album read from its service, or why it wasn't. */
export type AlbumRead =
  | { readonly ok: true; readonly album: ServiceAlbum }
  | { readonly ok: false; readonly reason: TrackReadFailure };

/** The album an album embed page shows, "notFound", or null when it shows none. */
const embedAlbum = (html: string): ServiceAlbum | "notFound" | null => {
  const props = embedPageProps(html);
  if (props === null || props === "notFound") return props;
  const entity = at(props, "state", "data", "entity");
  const title = text(at(entity, "name")) ?? text(at(entity, "title"));
  if (text(at(entity, "type")) !== "album" || title === null) return null;
  return {
    title,
    // The page names the artists only as its subtitle, "A, B": a name with a comma splits.
    artists: (text(at(entity, "subtitle")) ?? "")
      .split(", ")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
    artworkUrl: largestImage(at(entity, "visualIdentity", "image")),
  };
};

/**
 * Reads the album [albumId] from its embed page through [send], sending
 * Spotify the album id and nothing else: its title, artists and largest
 * cover. An album Spotify doesn't have is `missing`, Spotify out of reach
 * `unreachable`, and any other answer `failed`.
 */
export const readSpotifyAlbum = async (
  albumId: string,
  send: SpotifyTransport,
): Promise<AlbumRead> => {
  let answer;
  try {
    answer = await send(embedRequest("album", albumId));
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const album = answer.status === 200 ? embedAlbum(answer.body) : null;
  if (album === null) return { ok: false, reason: "failed" };
  return album === "notFound" ? { ok: false, reason: "missing" } : { ok: true, album };
};

/** An album a YT Music Albums search found. */
export interface FoundYtAlbum {
  readonly title: string;
  readonly artists: readonly string[];
  readonly browseId: string;
}

/** Where an album link goes: the YT Music album page to open, or why none opens. */
export type AlbumLinkOpening = { readonly album: string } | AlbumLinkFailure;

/** Why an album link opens no album page. */
type AlbumLinkFailure = { readonly play: "failed"; readonly failure: SongLinkFailure };

/**
 * The YT Music album [album] (as its service read it) opens on: one Albums
 * search ([search], null when it got no answer) for its title and main
 * artist, and the album there with the same title (`releaseTitle`) by one of
 * its artists (`pickStreamedAlbum`). A search that answered without it is
 * `albumNotFound`; no answer is YouTube Music not answering (`failed`).
 */
export const albumLinkOpening = async (
  album: ServiceAlbum,
  search: (query: string) => Promise<readonly FoundYtAlbum[] | null>,
): Promise<AlbumLinkOpening> => {
  const found = await search(`${album.title} ${album.artists[0] ?? ""}`.trim());
  if (found === null) return { play: "failed", failure: "failed" };
  const browseId = pickStreamedAlbum(album, found);
  return browseId === null
    ? {
        play: "failed",
        failure: { albumNotFound: { title: album.title, artists: album.artists } },
      }
    : { album: browseId };
};

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
