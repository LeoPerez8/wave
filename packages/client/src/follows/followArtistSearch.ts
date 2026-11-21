/**
 * Find artists to follow's question to Deezer (docs/spec.md, Followed Artists), asked the same
 * way by the phone and by the desktop's main process.
 */
import { deezerArtistSearchUrl, deezerFollowArtists, type DeezerFollowArtist } from "@wave/core";

/**
 * The artists Deezer names for [query]; null when it gave no answer (offline, an error, a reply
 * that isn't an artist search's, or [signal] aborted), which isn't an answer with no artists.
 */
export const askFollowArtists = async (
  fetch: typeof globalThis.fetch,
  query: string,
  signal: AbortSignal,
): Promise<readonly DeezerFollowArtist[] | null> => {
  try {
    const response = await fetch(deezerArtistSearchUrl(query), { signal });
    if (!response.ok) return null;
    return deezerFollowArtists(await response.json());
  } catch {
    return null;
  }
};
