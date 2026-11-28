/**
 * Smart links (docs/spec.md, "Opening a song link" › Smart links): a
 * release's page that lists one button per service. Wave reads the page and
 * opens the link it points to (`smartLinkTarget`). Only hosts whose pages
 * carry the services' links in their HTML are here: fanlink.tv, song.link,
 * album.link, lnk.to (and an artist's `<name>.lnk.to`) and DistroKid's
 * HyperFollow.
 */

import { addressIn, linkParts } from "./linkText.ts";

/**
 * The smart-link hosts, as Android's link filter in app.config.ts declares
 * them: a host (`*.` for any subdomain) and the path prefix a release's page
 * starts with, when only that path is a release's.
 */
export const SMART_LINK_HOSTS: readonly {
  readonly host: string;
  readonly pathPrefix?: string;
}[] = [
  { host: "fanlink.tv" },
  { host: "song.link" },
  { host: "album.link" },
  { host: "lnk.to" },
  { host: "*.lnk.to" },
  { host: "distrokid.com", pathPrefix: "/hyperfollow/" },
  { host: "www.distrokid.com", pathPrefix: "/hyperfollow/" },
];

/** Whether [host] is the filter entry [entry]'s. */
const onHost = (entry: (typeof SMART_LINK_HOSTS)[number], host: string): boolean =>
  entry.host.startsWith("*.") ? host.endsWith(entry.host.slice(1)) : host === entry.host;

/**
 * Whether [host] and [path] are a smart link's page: a release's, past the
 * entry's path prefix, not the service's home.
 */
const smartPage = (host: string, path: string): boolean =>
  SMART_LINK_HOSTS.some((entry) => {
    if (!onHost(entry, host)) return false;
    const prefix = entry.pathPrefix ?? "/";
    if (!path.startsWith(prefix)) return false;
    const rest = path.slice(prefix.length).replace(/\/+$/u, "");
    // Under a prefix (HyperFollow's), a release is `<artist>/<release>`; elsewhere any path is.
    return entry.pathPrefix === undefined ? rest !== "" : /^[^/]+\/[^/]+/u.test(rest);
  });

/**
 * The smart link in [text] (the first web address in it, else the whole text
 * as a link without its scheme), over https, its parameters kept and its
 * fragment dropped; null when it isn't one.
 */
export const smartLinkPage = (text: string): string | null => {
  const parts = linkParts(addressIn(text) ?? text.trim());
  if (parts === null || !smartPage(parts.host, parts.path)) return null;
  return `https://${parts.host}${parts.path}${parts.query === "" ? "" : `?${parts.query}`}`;
};
