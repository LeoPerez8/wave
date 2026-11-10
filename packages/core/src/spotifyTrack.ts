/**
 * Reading a Spotify track without an account or key, for a Spotify song link
 * (docs/spec.md, "Opening a song link"): its embed page
 * (`open.spotify.com/embed/track/<id>`) gives the title, artists, length and
 * cover. The request goes through the app's transport; Core builds and reads it.
 */

import { array, at, positive, text } from "./json.ts";
import type { ServiceTrack, TrackRead } from "./serviceTrack.ts";
import { embedPageProps, embedRequest, type SpotifyTransport } from "./spotifyPlaylist.ts";

/** The largest image in a list of `{ url, maxWidth }`, which Spotify doesn't order by size. */
const largestImage = (images: unknown): string | null => {
  let best: { readonly url: string; readonly width: number } | null = null;
  for (const image of array(images)) {
    const url = text(at(image, "url"));
    const width = positive(at(image, "maxWidth")) ?? 0;
    if (url !== null && (best === null || width > best.width)) best = { url, width };
  }
  return best?.url ?? null;
};

/** The track a track embed page shows, "notFound", or null when it shows none. */
const embedTrack = (html: string): ServiceTrack | "notFound" | null => {
  const props = embedPageProps(html);
  if (props === null || props === "notFound") return props;
  const entity = at(props, "state", "data", "entity");
  const title = text(at(entity, "name")) ?? text(at(entity, "title"));
  if (text(at(entity, "type")) !== "track" || title === null) return null;
  return {
    title,
    artists: array(at(entity, "artists"))
      .map((artist) => text(at(artist, "name")))
      .filter((name) => name !== null),
    // The embed page names no album.
    album: null,
    durationMs: positive(at(entity, "duration")),
    artworkUrl: largestImage(at(entity, "visualIdentity", "image")),
  };
};

/**
 * Reads the track [trackId] from its embed page through [send], sending
 * Spotify the track id and nothing else: its title, artists (every credited
 * one, in Spotify's order), length and largest cover. The page names no
 * album. A track Spotify doesn't have is `missing`, Spotify out of reach
 * `unreachable`, and any other answer `failed`.
 */
export const readSpotifyTrack = async (
  trackId: string,
  send: SpotifyTransport,
): Promise<TrackRead> => {
  let answer;
  try {
    answer = await send(embedRequest("track", trackId));
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const track = answer.status === 200 ? embedTrack(answer.body) : null;
  if (track === null) return { ok: false, reason: "failed" };
  return track === "notFound" ? { ok: false, reason: "missing" } : { ok: true, song: track };
};
