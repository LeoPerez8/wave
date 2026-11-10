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

/**
 * What a service's link names: a page (its kind, lower case, and its id, as
 * written), a short link to follow (its address, parameters dropped), or
 * nothing Wave reads on the service's own hosts (`other`).
 */
export type ServiceAddress =
  | { readonly at: "page"; readonly kind: string; readonly id: string }
  | { readonly at: "short"; readonly url: string }
  | { readonly at: "other" };

/** Where a service's links live: its page hosts and their path, and its short links' hosts and theirs. */
interface ServiceHosts {
  readonly pages: ReadonlySet<string>;
  /** A page's path, the page's kind and id captured. */
  readonly pagePath: RegExp;
  /** Each short-link host with the path its codes take. */
  readonly shorts: ReadonlyMap<string, RegExp>;
}

const servicePage = (kind: string, id: string): ServiceAddress => ({
  at: "page",
  kind: kind.toLowerCase(),
  id,
});

/** What [parts] name on the service with [hosts]; null when the link isn't the service's. */
const serviceAddress = (parts: LinkParts, hosts: ServiceHosts): ServiceAddress | null => {
  if (hosts.pages.has(parts.host)) {
    const page = hosts.pagePath.exec(parts.path);
    return page === null ? { at: "other" } : servicePage(page[1] ?? "", page[2] ?? "");
  }
  const short = hosts.shorts.get(parts.host);
  if (short === undefined) return null;
  return short.test(parts.path)
    ? { at: "short", url: `https://${parts.host}${parts.path.replace(/\/$/u, "")}` }
    : { at: "other" };
};

/** A short link's code, as the whole path. */
const SHORT_CODE = /^\/[\w-]+\/?$/u;

/** What every Spotify id is: 22 base-62 characters. */
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/u;
/** `spotify:<kind>:<id>`, also as an old URI with its owner (`spotify:user:<user>:playlist:<id>`). */
const SPOTIFY_URI = /^spotify:(?:user:[^:\s]+:)?([a-z]+):([^:\s]*)$/iu;
/**
 * Spotify's pages on open.spotify.com, at `/<kind>/<id>` after a locale
 * (`/intl-pt`), the embed player's `/embed` or an old link's `/user/<user>`,
 * and its short share links (Branch.io), which only Spotify can follow.
 */
const SPOTIFY: ServiceHosts = {
  pages: new Set(["open.spotify.com"]),
  pagePath: /^(?:\/intl-[\w-]+)?(?:\/embed)?(?:\/user\/[^/]+)?\/([a-z]+)\/([^/]+)\/?$/iu,
  shorts: new Map([
    ["spotify.link", SHORT_CODE],
    ["spotify.app.link", SHORT_CODE],
  ]),
};

/** Whether [id] is shaped like a Spotify id. */
export const isSpotifyId = (id: string): boolean => SPOTIFY_ID.test(id);

/**
 * What [link] (one link, as `linkInText` or `addressIn` gives it) names on
 * Spotify: a `spotify:` URI or an `open.spotify.com` page, or a
 * `spotify.link` short link. Null when it isn't Spotify's.
 */
export const spotifyAddress = (link: string): ServiceAddress | null => {
  const uri = SPOTIFY_URI.exec(link);
  if (uri !== null) return servicePage(uri[1] ?? "", uri[2] ?? "");
  const parts = linkParts(link);
  return parts === null ? null : serviceAddress(parts, SPOTIFY);
};

/**
 * Deezer's pages on deezer.com, at `/<kind>/<id>` after a locale (`/br`,
 * `/en`, `/pt-br`), and its short share links, which only Deezer can follow:
 * `link.deezer.com/s/<code>` (the apps' share format) and Firebase's
 * `deezer.page.link/<code>` (also `dzr.page.link`).
 */
const DEEZER: ServiceHosts = {
  pages: new Set(["deezer.com", "www.deezer.com"]),
  pagePath: /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/([a-z]+)\/([^/]+)\/?$/iu,
  shorts: new Map([
    ["link.deezer.com", /^\/s\/[\w-]+\/?$/u],
    ["deezer.page.link", SHORT_CODE],
    ["dzr.page.link", SHORT_CODE],
  ]),
};
/**
 * What every Deezer id is: digits. Deezer reads the number at the start of an
 * id and ignores what follows (`302127x` is 302127), so nothing else is one.
 */
const DEEZER_ID = /^\d{1,20}$/u;

/** Whether [id] is shaped like a Deezer id. */
export const isDeezerId = (id: string): boolean => DEEZER_ID.test(id);

/**
 * What [link] (one link, as `linkInText` or `addressIn` gives it) names on
 * Deezer: a `deezer.com` page or a short link (`link.deezer.com/s/<code>`,
 * `deezer.page.link/<code>`). Null when it isn't Deezer's.
 */
export const deezerAddress = (link: string): ServiceAddress | null => {
  const parts = linkParts(link);
  return parts === null ? null : serviceAddress(parts, DEEZER);
};
