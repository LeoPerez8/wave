import {
  geniusLyricsCandidates,
  geniusLyricsSearchRequest,
  type GeniusLyricsSearchState,
} from "@wave/core";

const REQUEST_TIMEOUT_MS = 15_000;

/** The JSON response for a query, or an explicit no-request outcome. */
export interface GeniusLyricsSearchPorts {
  readonly enabled: boolean;
  readonly signedIn: boolean | null;
  readonly isOnline: () => boolean;
  readonly ask: (path: string) => Promise<unknown>;
}

/**
 * Requests a settled Genius state after policy checks; network errors remain distinct from offline.
 * Its hits are Genius's whole answer: Search's rows leave out the songs a Lyrics row shows.
 */
export const requestGeniusLyricsSearch = async (
  query: string,
  ports: GeniusLyricsSearchPorts,
): Promise<GeniusLyricsSearchState> => {
  const request = geniusLyricsSearchRequest(query, ports.enabled);
  if (!ports.enabled) return { query, status: "disabled" };
  if (request === null) return { query, status: "idle" };
  if (!ports.isOnline()) return { query, status: "offline" };
  if (ports.signedIn === null) return { query, status: "idle" };
  if (!ports.signedIn) return { query, status: "signedOut" };
  try {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      ports.ask(`/v1/genius/search?q=${encodeURIComponent(request.query)}`),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Genius search timed out")),
          REQUEST_TIMEOUT_MS,
        );
      }),
    ]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });
    const hits = geniusLyricsCandidates(reply);
    return hits === null ? { query, status: "failed" } : { query, status: "hits", hits };
  } catch {
    return { query, status: ports.isOnline() ? "failed" : "offline" };
  }
};
