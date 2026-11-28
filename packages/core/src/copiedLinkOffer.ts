/**
 * Offering a copied link (docs/spec.md, "Opening a song link"): when Wave
 * comes back to the foreground with a link it opens on the clipboard, a toast
 * names the link's service and kind and offers what sharing it to Wave does.
 * The toast is built from the link alone, so nothing is asked of any service
 * before its action is tapped.
 */

import { addressIn, linkParts } from "./linkText.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { sharedTextImport, type SharedTextImport } from "./playlistLinks.ts";
import { songLinkKind, type SongLink } from "./songLinkOpening.ts";

/** The toast for a copied link: its line and its one action's label. */
export interface CopiedLinkOffer {
  readonly text: string;
  readonly action: string;
  /** What Wave keeps once it's offered, so it isn't offered again (`offeredLinkKey`). */
  readonly key: string;
}

/** A link Wave opens, as `sharedTextImport` reads it. */
type OpenedLink = Exclude<SharedTextImport, { readonly kind: "notice" }>;

/** The link [text] holds that sharing it to Wave opens, or null. */
const openedLink = (text: string): OpenedLink | null => {
  const shared = sharedTextImport(text, { ytMusic: true });
  return shared.kind === "notice" ? null : shared;
};

/**
 * What a link is, whatever its address carries besides: its service and id
 * (a short link's address), so a link copied again with other parameters, or
 * a video's YouTube link after its YouTube Music one, is the same link.
 */
const linkKey = (shared: OpenedLink): string => {
  const { service, ...id } = shared.link;
  return [shared.kind, service, ...Object.values(id)].join(":");
};

/**
 * What Wave keeps as the link last offered for [text]: a link it put on the
 * clipboard itself, or one a share or a tap opened it with, counts as
 * offered. Null for text that isn't a link Wave opens.
 */
export const offeredLinkKey = (text: string): string | null => {
  const shared = openedLink(text);
  return shared === null ? null : linkKey(shared);
};

/** The services the toast names. */
type CopiedLinkService = "ytMusic" | "youtube" | "spotify" | "deezer";

/** How the toast names a service: a brand, the same in every language. */
const SERVICE_NAMES: Readonly<Record<CopiedLinkService, string>> = {
  ytMusic: "YT Music",
  youtube: "YouTube",
  spotify: "Spotify",
  deezer: "Deezer",
};

/** YouTube's links carry YouTube Music's name only from its own host. */
const youtubeService = (text: string): CopiedLinkService =>
  linkParts(addressIn(text) ?? text.trim())?.host === "music.youtube.com" ? "ytMusic" : "youtube";

/** The service a song, album or artist link is from. */
const songLinkService = (link: SongLink, text: string): CopiedLinkService => {
  switch (link.service) {
    case "spotify":
    case "spotifyShort":
    case "spotifyAlbum":
    case "spotifyArtist":
      return "spotify";
    case "deezer":
    case "deezerShort":
    case "deezerArtist":
      return "deezer";
    default:
      return youtubeService(text);
  }
};

/**
 * The toast a copied [text] gets: for a link sharing it to Wave opens (Core's
 * `sharedTextImport`), its service and kind with Listen for a song, Import
 * for a playlist and Open for an album, an artist or a short link, whose kind
 * is known only once followed. Null for anything else, and for the link
 * offered last ([lastOffered], its `key`).
 */
export const copiedLinkOffer = (
  text: string,
  lastOffered: string | null,
  language: AppLanguage = "en",
): CopiedLinkOffer | null => {
  const shared = openedLink(text);
  if (shared === null) return null;
  const key = linkKey(shared);
  if (key === lastOffered) return null;
  return { ...toastFor(shared, text, language), key };
};

/** The toast's line and action for [shared], copied as [text]. */
const toastFor = (
  shared: OpenedLink,
  text: string,
  language: AppLanguage,
): Omit<CopiedLinkOffer, "key"> => {
  const words = catalogueOf(language).imports;
  if (shared.kind === "import") {
    const service =
      SERVICE_NAMES[shared.link.service === "ytMusic" ? youtubeService(text) : "spotify"];
    return { text: words.copiedPlaylist(service), action: words.import };
  }
  const link = shared.link;
  const service = SERVICE_NAMES[songLinkService(link, text)];
  if (link.service === "spotifyShort" || link.service === "deezerShort")
    return { text: words.copiedLink(service), action: words.open };
  switch (songLinkKind(link)) {
    case "song":
      return { text: words.copiedSongLink(service), action: words.listen };
    case "album":
      return { text: words.copiedAlbum(service), action: words.open };
    case "artist":
      return { text: words.copiedArtist(service), action: words.open };
  }
};

/** Wave as it comes back to the foreground, for `looksAtClipboard`. */
export interface CopiedLinkReturn {
  /** Settings › Accounts › Offer copied links. */
  readonly offerCopiedLinks: boolean;
  readonly ytMusic: boolean;
  readonly online: boolean;
  /** The welcome tour isn't over. */
  readonly welcomeTour: boolean;
  /** A share or a tapped link opened Wave on this return. */
  readonly openedByLink: boolean;
}

/**
 * Whether Wave looks at the clipboard on this return: never with Offer copied
 * links off, and not with YT Music off, offline, during the welcome tour or
 * when a share or a tapped link opened it. A link not looked at isn't marked
 * offered, so it's offered on a later return (once YT Music is back on or the
 * phone is back online); one a share or tap opened counts as offered
 * (`offeredLinkKey`).
 */
export const looksAtClipboard = ({
  offerCopiedLinks,
  ytMusic,
  online,
  welcomeTour,
  openedByLink,
}: CopiedLinkReturn): boolean =>
  offerCopiedLinks && ytMusic && online && !welcomeTour && !openedByLink;

/**
 * What Android's `ClipDescription` says about the clip, read without its text
 * (`WaveNative.readClipHint`), so reading it shows no paste notice.
 */
export interface ClipHint {
  /** The clip's MIME types. */
  readonly mimeTypes: readonly string[];
  /**
   * Whether Android's text classifier has looked at the clip: done, still
   * running, or not at all (a long text, no classifier).
   */
  readonly classification: "complete" | "pending" | "notPerformed";
  /** The classifier's confidence that the clip holds a link, 0 to 1; null until it's complete. */
  readonly urlConfidence: number | null;
  /** The copying app marked it sensitive (a password). */
  readonly sensitive: boolean;
  /** When it was copied (the description's timestamp), which tells one clip from the next. */
  readonly timestamp: number;
}

/** The MIME types of a clip whose text could be a link. */
const TEXT_TYPES: ReadonlySet<string> = new Set(["text/plain", "text/html", "text/uri-list"]);
/** The classifier's confidence from which a clip is likely a link. */
const LIKELY_LINK = 0.5;

/**
 * Whether Wave reads the clip's text, which makes Android 12+ show "Wave
 * pasted from your clipboard": only text that's likely a link (a URI list, or
 * text the classifier found a link in), never a clip marked sensitive, and a
 * clip only once ([lastRead], the timestamp of the clip read last). A clip
 * still being classified waits for a later return; one Android didn't
 * classify is read, since nothing else tells.
 */
export const readsCopiedText = (hint: ClipHint, lastRead: number | null): boolean => {
  if (hint.sensitive || hint.timestamp === lastRead) return false;
  if (!hint.mimeTypes.some((type) => TEXT_TYPES.has(type))) return false;
  if (hint.mimeTypes.includes("text/uri-list")) return true;
  switch (hint.classification) {
    case "complete":
      return (hint.urlConfidence ?? 0) >= LIKELY_LINK;
    case "pending":
      return false;
    case "notPerformed":
      return true;
  }
};
