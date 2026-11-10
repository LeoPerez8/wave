/**
 * Reading a web address out of pasted or shared text, for the links Wave
 * opens: playlists (`playlistLinks.ts`) and songs (`songLinkOpening.ts`).
 */

/** `scheme://host/path?query#fragment`, the scheme optional; the host has a dot. */
const LINK = /^(?:https?:\/\/)?([^/?#\s.]+(?:\.[^/?#\s.]+)+)([^?#\s]*)(?:\?([^#\s]*))?(?:#\S*)?$/iu;

/** A link's parts: its host (lower case), its path and its query string. */
export interface LinkParts {
  readonly host: string;
  readonly path: string;
  readonly query: string;
}

/** [text]'s host, path and query when it is one link (the scheme optional); null otherwise. */
export const linkParts = (text: string): LinkParts | null => {
  const parts = LINK.exec(text);
  return parts === null
    ? null
    : { host: (parts[1] ?? "").toLowerCase(), path: parts[2] ?? "", query: parts[3] ?? "" };
};

/** The value of [name] in a query string, undecoded; null when it has none. */
export const queryValue = (query: string, name: string): string | null => {
  for (const pair of query.split("&")) {
    const at = pair.indexOf("=");
    if (at >= 0 && pair.slice(0, at) === name) return pair.slice(at + 1);
  }
  return null;
};

/** A web address or a Spotify URI among words, as an app shares a link with its title. */
const ADDRESS = /\bhttps?:\/\/\S+|\bspotify:[\w:]+/iu;
/** Punctuation that ends a sentence or closes a bracket or quote, not the address before it. */
const AFTER_ADDRESS = /[.,!?;:'")\]}>»”’]+$/u;

/** The first web address in [text], without the punctuation after it; null when it has none. */
export const addressIn = (text: string): string | null => {
  const address = ADDRESS.exec(text)?.[0];
  return address === undefined ? null : address.replace(AFTER_ADDRESS, "");
};

/**
 * What [text] offers as one link: the text itself when it has no spaces, else
 * the first address among its words (the whole text when it has none).
 */
export const linkInText = (text: string): string => {
  const whole = text.trim();
  return /\s/u.test(whole) ? (addressIn(whole) ?? whole) : whole;
};

const SPOTIFY_HOST = "open.spotify.com";
/** Spotify's short share links (Branch.io), which only Spotify can follow. */
const SPOTIFY_SHORT_HOSTS = new Set(["spotify.link", "spotify.app.link"]);
/** What every Spotify id is: 22 base-62 characters. */
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/u;
/** `spotify:<kind>:<id>`, also as an old URI with its owner (`spotify:user:<user>:playlist:<id>`). */
const SPOTIFY_URI = /^spotify:(?:user:[^:\s]+:)?([a-z]+):([^:\s]*)$/iu;
/**
 * A path on open.spotify.com: `/<kind>/<id>`, after a locale (`/intl-pt`),
 * the embed player's `/embed` or an old link's `/user/<user>`.
 */
const SPOTIFY_PATH = /^(?:\/intl-[\w-]+)?(?:\/embed)?(?:\/user\/[^/]+)?\/([a-z]+)\/([^/]+)\/?$/iu;
/** A short link's code, from its path. */
const SHORT_CODE = /^\/([\w-]+)\/?$/u;

/** Whether [id] is shaped like a Spotify id. */
export const isSpotifyId = (id: string): boolean => SPOTIFY_ID.test(id);

/**
 * What a Spotify link names: a page (its kind, lower case, and its id, as
 * written), a short link to follow (its address, parameters dropped), or
 * nothing Wave reads on Spotify's own host.
 */
export type SpotifyAddress =
  | { readonly at: "page"; readonly kind: string; readonly id: string }
  | { readonly at: "short"; readonly url: string }
  | { readonly at: "spotify" };

const spotifyPage = (kind: string, id: string): SpotifyAddress => ({
  at: "page",
  kind: kind.toLowerCase(),
  id,
});

/**
 * What [link] (one link, as `linkInText` or `addressIn` gives it) names on
 * Spotify: a `spotify:` URI or an `open.spotify.com` page, or a
 * `spotify.link` short link. Null when it isn't Spotify's.
 */
export const spotifyAddress = (link: string): SpotifyAddress | null => {
  const uri = SPOTIFY_URI.exec(link);
  if (uri !== null) return spotifyPage(uri[1] ?? "", uri[2] ?? "");
  const parts = linkParts(link);
  if (parts === null) return null;
  if (parts.host === SPOTIFY_HOST) {
    const page = SPOTIFY_PATH.exec(parts.path);
    return page === null ? { at: "spotify" } : spotifyPage(page[1] ?? "", page[2] ?? "");
  }
  if (!SPOTIFY_SHORT_HOSTS.has(parts.host)) return null;
  const code = SHORT_CODE.exec(parts.path)?.[1];
  return code === undefined
    ? { at: "spotify" }
    : { at: "short", url: `https://${parts.host}/${code}` };
};

/** deezer.com's hosts for its pages. */
const DEEZER_HOSTS = new Set(["deezer.com", "www.deezer.com"]);
/**
 * Deezer's short share links, which only Deezer can follow, each with how its
 * path holds the code: `link.deezer.com/s/<code>` (the apps' share format) and
 * Firebase's `deezer.page.link/<code>` (also `dzr.page.link`).
 */
const DEEZER_SHORT_PATHS: ReadonlyMap<string, RegExp> = new Map([
  ["link.deezer.com", /^\/s\/([\w-]+)\/?$/u],
  ["deezer.page.link", SHORT_CODE],
  ["dzr.page.link", SHORT_CODE],
]);
/** A path on deezer.com: `/<kind>/<id>`, after a locale (`/br`, `/en`, `/pt-br`). */
const DEEZER_PATH = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/([a-z]+)\/([^/]+)\/?$/iu;
/**
 * What every Deezer id is: digits. Deezer reads the number at the start of an
 * id and ignores what follows (`302127x` is 302127), so nothing else is one.
 */
const DEEZER_ID = /^\d{1,20}$/u;

/** Whether [id] is shaped like a Deezer id. */
export const isDeezerId = (id: string): boolean => DEEZER_ID.test(id);

/**
 * What a Deezer link names: a page (its kind, lower case, and its id, as
 * written), a short link to follow (its address, parameters dropped), or
 * nothing Wave reads on Deezer's own hosts.
 */
export type DeezerAddress =
  | { readonly at: "page"; readonly kind: string; readonly id: string }
  | { readonly at: "short"; readonly url: string }
  | { readonly at: "deezer" };

/**
 * What [link] (one link, as `linkInText` or `addressIn` gives it) names on
 * Deezer: a `deezer.com` page or a short link (`link.deezer.com/s/<code>`,
 * `deezer.page.link/<code>`). Null when it isn't Deezer's.
 */
export const deezerAddress = (link: string): DeezerAddress | null => {
  const parts = linkParts(link);
  if (parts === null) return null;
  if (DEEZER_HOSTS.has(parts.host)) {
    const page = DEEZER_PATH.exec(parts.path);
    return page === null
      ? { at: "deezer" }
      : { at: "page", kind: (page[1] ?? "").toLowerCase(), id: page[2] ?? "" };
  }
  const shortPath = DEEZER_SHORT_PATHS.get(parts.host);
  if (shortPath === undefined) return null;
  const code = shortPath.exec(parts.path)?.[1];
  return code === undefined
    ? { at: "deezer" }
    : { at: "short", url: `https://${parts.host}${parts.path.replace(/\/$/u, "")}` };
};
