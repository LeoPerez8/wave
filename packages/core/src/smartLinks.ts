/**
 * What a smart link's page points to (docs/spec.md, "Opening a song link" ›
 * Smart links): of the links in it Wave opens, a song first, then an album,
 * then a playlist.
 */

import { linkParts } from "./linkText.ts";
import { recognisePlaylistLink } from "./playlistLinks.ts";
import { recogniseSongLink, type SongLink } from "./songLinkOpening.ts";

/** Whether the app opens a song, album or artist link (the desktop doesn't open them all yet). */
export type OpensSongLink = (link: SongLink) => boolean;

const opensAll: OpensSongLink = () => true;

/** Whether [link] is on YouTube Music's own host rather than YouTube's. */
const onYtMusic = (link: string): boolean => linkParts(link)?.host === "music.youtube.com";

/**
 * The page's text with its links written plainly: JSON's `\/` and `\u002F`,
 * and HTML's character references for `/`, `=`, `:`, `"` (JSON in an
 * attribute, which would otherwise run into the link) and `&`.
 */
const plain = (body: string): string =>
  body
    .replace(/\\\/|\\u002f/giu, "/")
    .replace(/&#(?:47|x2f);/giu, "/")
    .replace(/&#(?:61|x3d);/giu, "=")
    .replace(/&#(?:58|x3a);/giu, ":")
    .replace(/&(?:quot|#34|#x22);/giu, '"')
    .replace(/&(?:amp|#38|#x26);/giu, "&");

/** A link to a service's page, up to a quote, a space, a tag or an escape. */
const SERVICE_LINK =
  /https?:\/\/(?:open\.spotify\.com|music\.youtube\.com|(?:www\.|m\.)?youtube\.com|youtu\.be|(?:www\.)?deezer\.com)\/[^\s"'<>\\]*/giu;

/**
 * How early [link] goes, lowest first; null for a link Wave doesn't open from
 * a page, one [opens] leaves out, and an artist unless [artists] (a page's
 * artist buttons are its artist's, not the release's).
 */
const rank = (link: string, opens: OpensSongLink, artists: boolean): number | null => {
  const song = recogniseSongLink(link);
  if (song !== null) {
    if (!opens(song)) return null;
    switch (song.service) {
      case "ytMusic":
        // A YouTube video is often the release's music video: the services' songs go first.
        return onYtMusic(link) ? 0 : 3;
      case "spotify":
        return 1;
      case "deezer":
        return 2;
      case "spotifyAlbum":
        return 4;
      case "ytAlbum":
        return 5;
      case "ytAlbumPlaylist":
        return 6;
      case "ytArtist":
      case "spotifyArtist":
      case "deezerArtist":
        return artists ? 10 : null;
      case "spotifyShort":
      case "deezerShort":
        // A short link would need following again: the page's own links are enough.
        return null;
    }
  }
  const playlist = recognisePlaylistLink(link);
  if (!playlist.ok) return null;
  if (playlist.link.service === "spotify") return 8;
  if (playlist.link.service !== "ytMusic") return null;
  return onYtMusic(link) ? 7 : 9;
};

/** The best-ranked service link in [text] (`rank`), the first among equals. */
const bestLink = (text: string, opens: OpensSongLink, artists: boolean): string | null => {
  let best: { readonly link: string; readonly rank: number } | null = null;
  for (const [link] of plain(text).matchAll(SERVICE_LINK)) {
    const at = rank(link, opens, artists);
    if (at !== null && (best === null || at < best.rank)) best = { link, rank: at };
  }
  return best?.link ?? null;
};

/**
 * The link a smart link's page ([body], as downloaded) points to: of the
 * YouTube Music, YouTube, Spotify and Deezer links in it that Wave opens (and
 * [opens] takes), a song (YouTube Music, then Spotify, then Deezer, then a
 * YouTube video), else an album (Spotify, then a YouTube Music album's page,
 * then its playlist), else a playlist (YouTube Music, then Spotify, then
 * YouTube), the first in the page among equals. Short links and artists are
 * passed over. Null when it has none.
 */
export const smartLinkTarget = (body: string, opens: OpensSongLink = opensAll): string | null =>
  bestLink(body, opens, false);

/**
 * The service page a smart link redirected to ([url], where following it
 * landed), when it is one Wave opens (and [opens] takes), an artist's
 * included; null anywhere else.
 */
export const smartLinkLanding = (url: string, opens: OpensSongLink = opensAll): string | null =>
  bestLink(url, opens, true);
