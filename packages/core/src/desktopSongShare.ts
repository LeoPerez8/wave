/**
 * A song's Share submenu on the desktop (docs/spec-desktop.md, Sharing a song): the phone's link
 * destinations as menu items that copy (Copy Link, Spotify, YT Music), then the song's card as an
 * image, saved or copied. The links go by Core's `songLinkView`, as the phone's share sheet.
 */

import type { Catalogue } from "./catalogueEn.ts";
import type { SharePlaylistFailure } from "./playlistShare.ts";
import { songLinkView, type SongLinksState, type SpotifyTrackState } from "./songLinks.ts";
import type { SongLinkOption } from "./songShare.ts";

/** One item of a song's Share submenu: a link to copy (null: disabled, [note] says why), or its card. */
export type DesktopShareItem =
  | {
      readonly kind: "link";
      readonly option: SongLinkOption;
      readonly label: string;
      readonly url: string | null;
      readonly note: string | null;
    }
  | { readonly kind: "saveImage" | "copyImage"; readonly label: string };

/** The link items in the submenu's order. */
const LINKS: readonly SongLinkOption[] = ["copyLink", "spotify", "ytMusic"];

/**
 * The Share submenu of a song whose links are [links], in [strings]' language: Copy Link, Copy
 * Spotify Link and Copy YT Music Link, then Save Image and Copy Image. [links] is null with YT
 * Music off, which leaves the two image items only.
 */
export const desktopSongShareMenu = (
  links: SongLinksState | null,
  strings: Catalogue,
): DesktopShareItem[] => {
  const labels: Record<SongLinkOption, string> = {
    copyLink: strings.share.copyLink,
    spotify: strings.share.copySpotifyLink,
    ytMusic: strings.share.copyYtMusicLink,
  };
  return [
    ...(links === null
      ? []
      : LINKS.map((option): DesktopShareItem => {
          const { url, note } = songLinkView(option, links, strings);
          return { kind: "link", option, label: labels[option], url, note };
        })),
    { kind: "saveImage", label: strings.share.saveImage },
    { kind: "copyImage", label: strings.share.copyImage },
  ];
};

/** What a search of Spotify's Web API for the same recording found, or why it couldn't ask. */
export type SpotifyRecordingAnswer =
  | { readonly ok: true; readonly uri: string | null }
  | { readonly ok: false; readonly reason: SharePlaylistFailure };

/**
 * The song's Spotify link from the Web API's search for the same recording ([answer]): the
 * track's `open.spotify.com` page, No Match without one, else why there is none.
 */
export const spotifyRecordingLink = (answer: SpotifyRecordingAnswer): SpotifyTrackState => {
  if (!answer.ok)
    return {
      status:
        answer.reason === "offline"
          ? "offline"
          : answer.reason === "signedOut"
            ? "signedOut"
            : "failed",
    };
  if (answer.uri === null) return { status: "notFound" };
  return {
    status: "found",
    url: `https://open.spotify.com/track/${answer.uri.split(":").at(-1) ?? ""}`,
  };
};
