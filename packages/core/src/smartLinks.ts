/**
 * What a smart link's page points to (docs/spec.md, "Opening a song link" ›
 * Smart links): of the links in it Wave opens, a song first, then a Spotify
 * album, then a playlist, YouTube Music first among each.
 */

import { recognisePlaylistLink } from "./playlistLinks.ts";
import { recogniseSongLink } from "./songLinkOpening.ts";

/**
 * The page's text with its links written plainly: JSON's `\/` and `/`,
 * and HTML's character references for `/`, `=`, `:` and `&`.
 */
const plain = (body: string): string =>
  body
    .replace(/\\\/|\\u002f/giu, "/")
    .replace(/&#(?:47|x2f);/giu, "/")
    .replace(/&#(?:61|x3d);/giu, "=")
    .replace(/&#(?:58|x3a);/giu, ":")
    .replace(/&(?:amp|#38|#x26);/giu, "&");

/** A link to a service's page, up to a quote, a space, a tag or an escape. */
const SERVICE_LINK =
  /https?:\/\/(?:open\.spotify\.com|music\.youtube\.com|(?:www\.|m\.)?youtube\.com|(?:www\.)?deezer\.com)\/[^\s"'<>\\]*/giu;

/** How early [link] goes, lowest first; null for a link Wave doesn't open from a page. */
const rank = (link: string): number | null => {
  const song = recogniseSongLink(link);
  if (song !== null) {
    switch (song.service) {
      case "ytMusic":
        return 0;
      case "spotify":
        return 1;
      case "deezer":
        return 2;
      case "spotifyAlbum":
        return 3;
      default:
        // A short link would need following again: the page's own links are enough.
        return null;
    }
  }
  const playlist = recognisePlaylistLink(link);
  if (!playlist.ok) return null;
  if (playlist.link.service === "spotify") return 5;
  if (playlist.link.service !== "ytMusic") return null;
  return new URL(link).host === "music.youtube.com" ? 4 : 6;
};

/**
 * The link a smart link's page ([body], as downloaded) points to: of the
 * YouTube Music, YouTube, Spotify and Deezer links in it that Wave opens, a
 * song (YouTube Music, then Spotify, then Deezer), else a Spotify album, else
 * a playlist (YouTube Music, then Spotify, then YouTube), the first in the
 * page among equals. Null when it has none.
 */
export const smartLinkTarget = (body: string): string | null => {
  let best: { readonly link: string; readonly rank: number } | null = null;
  for (const [link] of plain(body).matchAll(SERVICE_LINK)) {
    const at = rank(link);
    if (at !== null && (best === null || at < best.rank)) best = { link, rank: at };
  }
  return best?.link ?? null;
};
