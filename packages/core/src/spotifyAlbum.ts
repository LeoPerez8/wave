/**
 * Opening an album link (docs/spec.md, "Opening a song link"). A Spotify
 * album's embed page (`open.spotify.com/embed/album/<id>`) gives its title,
 * artists and cover without an account or key, and one YT Music Albums search
 * finds the same album to open (a YouTube Music album's playlist opens in
 * `ytAlbumPlaylist.ts`). The requests go through the app's transport; Core
 * builds and reads them.
 */

import { at, text } from "./json.ts";
import type { TrackReadFailure } from "./serviceTrack.ts";
import type { SongLinkFailure } from "./songLinkOpening.ts";
import { embedPageProps, embedRequest, type SpotifyTransport } from "./spotifyPlaylist.ts";
import { largestImage } from "./spotifyTrack.ts";
import { pickStreamedAlbum } from "./streamedCredits.ts";

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
export type AlbumLinkFailure = { readonly play: "failed"; readonly failure: SongLinkFailure };

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
