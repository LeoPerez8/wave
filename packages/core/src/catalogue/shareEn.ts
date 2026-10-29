import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";
import type { PlaylistShareService, SharePlaylistFailure } from "../playlistShare.ts";

/** The share cards (lyrics, song, Recap) and sharing a playlist on YT Music or Spotify. */
export const shareEn = {
  preview: "Share preview",
  close: "Close",
  lyricsCard: "Lyrics card",
  changesColour: "Changes the card's colour",
  tapToChangeColour: "Tap the card to change its colour",
  shareLyrics: "Share Lyrics",
  shareSong: "Share Song",
  shareRecap: "Share Recap",
  /** A Recap slide's preview, for TalkBack. */
  recapSlide: (title: string) => `${title} Recap slide`,
  copyLink: "Copy Link",
  /** What the clipboard calls a copied song link. */
  songLink: "Song link",
  linkCopied: "Link copied",
  copyFailed: "Couldn't copy the link",
  linkShareFailed: "Couldn't share the link",
  /** Why a link destination has no link, under its label. */
  linkNotes: {
    offline: "Offline",
    failed: "Unavailable",
    notFound: "No Match",
    signedOut: "Signed Out",
  },
  instagramStories: "Instagram Stories",
  whatsApp: "WhatsApp",
  saveImage: "Save image",
  more: "More",
  savedToGallery: "Saved to your gallery",
  instagramFailed: "Couldn't open Instagram",
  whatsAppFailed: "Couldn't open WhatsApp",
  saveImageFailed: "Couldn't save the image",
  shareImageFailed: "Couldn't share the image",
  share: "Share",
  sharing: (playlist: string, service: string) => `Sharing ${playlist} on ${service}…`,
  nothingToShare: "Nothing to share",
  nothingFound: {
    ytMusic: "None of the playlist's songs are on YouTube Music.",
    spotify: "None of the playlist's songs are on Spotify.",
  } satisfies Record<PlaylistShareService, string>,
  shareFailed: "Couldn't share the playlist",
  /** What sharing says when it's done: "12 of 15 songs found". */
  found: (found: number, total: number) =>
    plural("en", total, {
      one: `${formatNumber("en", found)} of ${formatNumber("en", total)} song found`,
      other: `${formatNumber("en", found)} of ${formatNumber("en", total)} songs found`,
    }),
  signInTitle: (service: string) => `Sign In to ${service}`,
  signInMessage: {
    ytMusic:
      "Sharing a playlist makes an unlisted copy of it on your YouTube Music account, with a link anyone can open.",
    // Spotify's private playlists don't open for anyone else.
    spotify:
      "Sharing a playlist makes a public copy of it on your Spotify account, with a link anyone can open.",
  } satisfies Record<PlaylistShareService, string>,
  signIn: "Sign In",
  /** Why sharing on [service] stopped. */
  failures: {
    noSearchAnswer: (service: string) => `${service} didn't answer a search. Try again.`,
    offline: () => "Sharing needs a connection.",
    signedOut: (service: string) => `${service} signed you out. Sign in and share again.`,
    changed: (service: string) => `${service} changed something. Try again after updating Wave.`,
    failed: (service: string) => `${service} didn't take the playlist. Try again.`,
  } satisfies Record<SharePlaylistFailure, (service: string) => string>,
};
