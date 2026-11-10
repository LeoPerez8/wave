/**
 * Spotify and Deezer through `fetch`, for Core's readers (`readSpotifyPlaylist`,
 * `readSpotifyTrack`, `readDeezerTrack`) and for following their short links.
 * Each rejects when the service is out of reach or [signal] is aborted.
 */
import type { DeezerTransport, SpotifyTransport } from "@wave/core";

/** Spotify as Core's Spotify readers ask it. */
export const spotifyTransport =
  (signal: AbortSignal): SpotifyTransport =>
  async (request) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ?? undefined,
      signal,
    });
    return { status: response.status, body: await response.text() };
  };

/** Deezer's public API, as `readDeezerTrack` asks it: a GET with no cookies. */
export const deezerTransport =
  (signal: AbortSignal): DeezerTransport =>
  async (url) => {
    const response = await fetch(url, { credentials: "omit", signal });
    return { status: response.status, body: await response.text() };
  };

/**
 * Follows the short link [url] through its redirects, with no cookies, to
 * where it lands. Only when the landing page itself names the link's target
 * ([body]: Branch's page for apps, for Spotify's) is it downloaded, else it is
 * a `HEAD` and only the address it ended on is kept, with an empty body.
 */
export const followShortLink = async (
  url: string,
  { body }: { readonly body: boolean },
  signal: AbortSignal,
): Promise<{ readonly url: string; readonly body: string }> => {
  const response = await fetch(url, { method: body ? "GET" : "HEAD", credentials: "omit", signal });
  return { url: response.url, body: body ? await response.text() : "" };
};
