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
