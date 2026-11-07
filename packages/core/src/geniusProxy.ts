/**
 * Genius through Wave's sync service (docs/spec.md, "Genius About"): the
 * phone asks the service's fixed Genius routes, and the service asks Genius
 * with its own token. These are the only requests the routes take, each
 * standing for one of the Genius requests `genius.ts` and
 * `geniusAnnotations.ts` describe.
 */

import { geniusQueryUrl, geniusSearchQuery, geniusSongUrl } from "./genius.ts";
import { GENIUS_REFERENTS_MAX_PAGES, geniusReferentsUrl } from "./geniusAnnotations.ts";
import type { SongLookup } from "./lyricsAndGenre.ts";
import { exactParams } from "./proxyParams.ts";

/** The longest search the service takes (title and artist), in characters. */
export const GENIUS_SEARCH_MAX_LENGTH = 1_000;

/** The service's Genius search for [song]: `geniusSearchUrl`'s. */
export const geniusSearchPath = (song: Pick<SongLookup, "title" | "artist">): string =>
  `/v1/genius/search?q=${encodeURIComponent(geniusSearchQuery(song))}`;

/** The service's Genius song [id]: `geniusSongUrl`'s. */
export const geniusSongPath = (id: number): string => `/v1/genius/song?id=${id}`;

/** The service's page [page] of song [id]'s referents: `geniusReferentsUrl`'s. */
export const geniusReferentsPath = (id: number, page: number): string =>
  `/v1/genius/referents?song=${id}&page=${page}`;

/** A positive whole number written plainly ("12", never "012", "1e3" or "+1"); null otherwise. */
const wholeNumber = (text: string): number | null => {
  if (!/^[1-9][0-9]{0,15}$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
};

/**
 * The Genius request the service makes for a phone's [pathname] and
 * [params] (a `geniusSearchPath`, `geniusSongPath` or `geniusReferentsPath`
 * request), built by the same functions the phone used to call Genius with;
 * null for any other path, a parameter missing, repeated or extra, an id
 * that isn't a positive whole number, a page past
 * `GENIUS_REFERENTS_MAX_PAGES`, or an empty or overlong search.
 */
export const geniusUpstreamUrl = (pathname: string, params: URLSearchParams): string | null => {
  switch (pathname) {
    case "/v1/genius/search": {
      const [q] = exactParams(params, ["q"]) ?? [];
      if (q === undefined || q.trim() === "" || q.length > GENIUS_SEARCH_MAX_LENGTH) return null;
      return geniusQueryUrl(q);
    }
    case "/v1/genius/song": {
      const [id] = exactParams(params, ["id"]) ?? [];
      const song = id === undefined ? null : wholeNumber(id);
      return song === null ? null : geniusSongUrl(song);
    }
    case "/v1/genius/referents": {
      const values = exactParams(params, ["song", "page"]);
      if (values === null) return null;
      const song = wholeNumber(values[0] ?? "");
      const page = wholeNumber(values[1] ?? "");
      if (song === null || page === null || page > GENIUS_REFERENTS_MAX_PAGES) return null;
      return geniusReferentsUrl(song, page);
    }
    default:
      return null;
  }
};
