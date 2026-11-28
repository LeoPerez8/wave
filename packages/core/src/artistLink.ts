/**
 * Opening an artist link (docs/spec.md, "Opening a song link"): a Spotify
 * artist's embed page (`open.spotify.com/embed/artist/<id>`) or Deezer's
 * public API (`api.deezer.com/artist/<id>`) gives the artist's name without
 * an account or key, and one YT Music Artists search finds the artist of that
 * name to open. The requests go through the app's transport; Core builds and
 * reads them.
 */

import { at, text } from "./json.ts";
import type { DeezerTransport } from "./deezerTrack.ts";
import { isDeezerId } from "./linkText.ts";
import { deezerRefused } from "./releaseLookup.ts";
import type { TrackReadFailure } from "./serviceTrack.ts";
import type { SongLinkFailure } from "./songLinkOpening.ts";
import { embedPageProps, embedRequest, type SpotifyTransport } from "./spotifyPlaylist.ts";
import { pickYtArtist, type YtArtistCandidate } from "./ytArtist.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/** An artist's name read from their service, or why it wasn't. */
export type ArtistRead =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: TrackReadFailure };

/**
 * Reads the artist [artistId]'s name from their embed page through [send],
 * sending Spotify the artist id and nothing else. An artist Spotify doesn't
 * have is `missing`, Spotify out of reach `unreachable`, and any other answer
 * `failed`.
 */
export const readSpotifyArtist = async (
  artistId: string,
  send: SpotifyTransport,
): Promise<ArtistRead> => {
  let answer;
  try {
    answer = await send(embedRequest("artist", artistId));
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const props = answer.status === 200 ? embedPageProps(answer.body) : null;
  if (props === "notFound") return { ok: false, reason: "missing" };
  const entity = at(props, "state", "data", "entity");
  const name = text(at(entity, "name")) ?? text(at(entity, "title"));
  return text(at(entity, "type")) === "artist" && name !== null
    ? { ok: true, name }
    : { ok: false, reason: "failed" };
};

/** Deezer's "no data" error: an id it has no artist for. */
const NO_DATA = 800;

/** [body] parsed, or undefined when it isn't JSON. */
const parsed = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * Reads the artist [artistId]'s name from Deezer's public API through
 * [send], sending Deezer the artist id and nothing else. An id that isn't all
 * digits isn't asked for: it names no artist (`missing`), as an id Deezer
 * doesn't know does. Deezer out of reach, over its quota or busy is
 * `unreachable`, and any other answer `failed`.
 */
export const readDeezerArtist = async (
  artistId: string,
  send: DeezerTransport,
): Promise<ArtistRead> => {
  if (!isDeezerId(artistId)) return { ok: false, reason: "missing" };
  let answer;
  try {
    answer = await send(`https://api.deezer.com/artist/${artistId}`);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (answer.status !== 200) return { ok: false, reason: "failed" };
  const body = parsed(answer.body);
  if (deezerRefused(body)) return { ok: false, reason: "unreachable" };
  if (at(body, "error", "code") === NO_DATA) return { ok: false, reason: "missing" };
  const name = text(at(body, "name"));
  return text(at(body, "type")) === "artist" && name !== null
    ? { ok: true, name }
    : { ok: false, reason: "failed" };
};

/**
 * Where an artist link goes: the YT Music artist page to open (`UC…`) with
 * the name to head it, when known, or why none opens.
 */
export type ArtistLinkOpening =
  | { readonly artist: string; readonly name: string | null }
  | { readonly play: "failed"; readonly failure: SongLinkFailure };

/**
 * The YT Music artist the artist [name] (as their service read it) opens on:
 * one Artists search ([search], null when it got no answer) for the name, and
 * the artist there with the same name, the most followed among namesakes
 * (`pickYtArtist`). A search that answered without them is `artistNotFound`;
 * no answer is YouTube Music not answering (`failed`).
 */
export const artistLinkOpening = async (
  name: string,
  search: (query: string) => Promise<readonly YtArtistCandidate[] | null>,
): Promise<ArtistLinkOpening> => {
  const found = await search(name);
  if (found === null) return { play: "failed", failure: "failed" };
  const browseId = pickYtArtist(name, found);
  return browseId === null
    ? { play: "failed", failure: { artistNotFound: { name } } }
    : { artist: browseId, name };
};

/** A YT Music artist page read for its name, or why it wasn't. */
export type YtArtistNameRead =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: YtQuietReason | "disabled" };

/**
 * The YT Music artist the channel [channelId] opens on: the channel itself,
 * once YouTube Music reads it as an artist page ([read]). A channel it can't
 * read as one (YouTube Music answers no artist page for it, `failed`) isn't
 * found; offline and YT Music off say so.
 */
export const ytChannelLinkOpening = async (
  channelId: string,
  read: () => Promise<YtArtistNameRead>,
): Promise<ArtistLinkOpening> => {
  const page = await read();
  if (page.ok) return { artist: channelId, name: page.name };
  if (page.reason === "offline") return { play: "failed", failure: "artistOffline" };
  if (page.reason === "disabled") return { play: "failed", failure: "disabled" };
  return { play: "failed", failure: { artistNotFound: { name: null } } };
};
