import type { SpotifyTransport } from "@wave/core";

/**
 * Spotify through `fetch`, as Core's `readSpotifyPlaylist` and
 * `readSpotifyTrack` ask; rejects when Spotify is out of reach or [signal]
 * is aborted.
 */
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
