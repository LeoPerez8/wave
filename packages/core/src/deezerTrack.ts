/**
 * Reading a Deezer track without an account or key, for a Deezer song link
 * (docs/spec.md, "Opening a song link"): its public API
 * (`api.deezer.com/track/<id>`) gives the title, artists, album, length and
 * cover. The request goes through the app's transport; Core builds and reads it.
 */

import { array, at, positive, text } from "./json.ts";
import { isDeezerId } from "./linkText.ts";
import { deezerRefused } from "./releaseLookup.ts";
import type { ServiceTrack, TrackRead } from "./serviceTrack.ts";

/** Deezer's answer: its HTTP status and body. */
export interface DeezerAnswer {
  readonly status: number;
  readonly body: string;
}

/** Asks Deezer for the address it's given (a GET); rejects when Deezer can't be reached. */
export type DeezerTransport = (url: string) => Promise<DeezerAnswer>;

/** Deezer's "no data" error: an id it has no track for. */
const NO_DATA = 800;

/** The album's covers, largest first; `cover` itself is an API address that redirects. */
const COVERS = ["cover_xl", "cover_big", "cover_medium", "cover_small"] as const;

/** [body] parsed, or undefined when it isn't JSON. */
const parsed = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
};

/** The track an API answer describes, or null when it describes none. */
const apiTrack = (track: unknown): ServiceTrack | null => {
  const title = text(at(track, "title"));
  if (text(at(track, "type")) !== "track" || title === null) return null;
  const contributors = array(at(track, "contributors"))
    .map((contributor) => text(at(contributor, "name")))
    .filter((name) => name !== null);
  const main = text(at(track, "artist", "name"));
  const duration = positive(at(track, "duration"));
  return {
    title,
    artists: contributors.length > 0 ? contributors : main === null ? [] : [main],
    album: text(at(track, "album", "title")),
    durationMs: duration === null ? null : Math.round(duration * 1000),
    artworkUrl:
      COVERS.map((cover) => text(at(track, "album", cover))).find((url) => url !== null) ?? null,
  };
};

/**
 * Reads the track [trackId] from Deezer's public API through [send], sending
 * Deezer the track id and nothing else: its full title (its version, such as
 * "(Live)", included), artists (every contributor, featured guests too, in
 * Deezer's order; else the track's artist), album, length and largest cover.
 * Deezer reads the digits an id starts with and ignores the rest, so an id
 * that isn't all digits isn't asked for: it names no track (`missing`), as an
 * id Deezer doesn't know does. Deezer out of reach, over its quota or busy is
 * `unreachable`, and any other answer `failed`.
 */
export const readDeezerTrack = async (
  trackId: string,
  send: DeezerTransport,
): Promise<TrackRead> => {
  if (!isDeezerId(trackId)) return { ok: false, reason: "missing" };
  let answer;
  try {
    answer = await send(`https://api.deezer.com/track/${trackId}`);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (answer.status !== 200) return { ok: false, reason: "failed" };
  const body = parsed(answer.body);
  if (deezerRefused(body)) return { ok: false, reason: "unreachable" };
  if (at(body, "error", "code") === NO_DATA) return { ok: false, reason: "missing" };
  const song = apiTrack(body);
  return song === null ? { ok: false, reason: "failed" } : { ok: true, song };
};
