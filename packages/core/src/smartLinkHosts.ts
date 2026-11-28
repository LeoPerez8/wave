/**
 * Smart links (docs/spec.md, "Opening a song link" › Smart links): a
 * release's page that lists one button per service. Wave reads the page and
 * opens the link it points to (`smartLinkTarget`). Only hosts whose pages
 * carry the services' links in their HTML are here: fanlink.tv, song.link,
 * album.link, lnk.to (and an artist's `<name>.lnk.to`) and DistroKid's
 * HyperFollow.
 */

import { addressIn, linkParts } from "./linkText.ts";

/** Whether [host] and [path] are a smart link's page: a release's, not the service's home. */
const smartPage = (host: string, path: string): boolean => {
  const release = path.replace(/\/+$/u, "") !== "";
  if (host === "fanlink.tv" || host === "song.link" || host === "album.link") return release;
  if (host === "lnk.to" || host.endsWith(".lnk.to")) return release;
  return (
    (host === "distrokid.com" || host === "www.distrokid.com") &&
    /^\/hyperfollow\/[^/]+\/[^/]+/u.test(path)
  );
};

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
