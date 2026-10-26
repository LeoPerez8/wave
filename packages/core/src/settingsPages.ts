/**
 * Settings is a short list of rows, each opening a page of its own with the
 * settings of one area. Add a page here (its id, the title its row and header
 * show, the route its screen lives at, and its row's glyph), then give it a
 * screen under `app/settings/` and, if it helps, a summary line.
 */

import { counted } from "./listening.ts";
import { queuedDownloadsSummary, type QueuedDownloadCounts } from "./queuedDownloads.ts";
import type { SpotifySession } from "./spotifyAccount.ts";
import type { WaveSession } from "./waveAccount.ts";
import type { YtSession } from "./ytAccount.ts";

/** Each Settings page, by id. */
export type SettingsPage =
  | "library"
  | "appearance"
  | "layout"
  | "swipeActions"
  | "playback"
  | "history"
  | "lyricsAndTags"
  | "downloads"
  | "accounts"
  | "developer";

/**
 * A Settings row's glyph, by name; the app draws each with a Tabler line icon
 * (`settings/SettingsGlyph.tsx`).
 */
export type SettingsIcon =
  "history" | "books" | "palette" | "layout" | "swipe" | "play" | "quote" | "download" | "user" | "code";

export interface SettingsPageEntry {
  readonly page: SettingsPage;
  /** What its row in Settings and its own header say. */
  readonly title: string;
  /** Where its screen is (also `wave://settings/<…>`). */
  readonly route: `/settings/${string}`;
  /** Its row's glyph, drawn in the secondary text tone. */
  readonly icon: SettingsIcon;
}

/** The pages, in the order Settings lists them. */
export const SETTINGS_PAGES = [
  { page: "library", title: "Library", route: "/settings/library", icon: "books" },
  {
    page: "appearance",
    title: "Appearance",
    route: "/settings/appearance",
    icon: "palette",
  },
  { page: "layout", title: "Layout", route: "/settings/layout", icon: "layout" },
  {
    page: "swipeActions",
    title: "Swipe actions",
    route: "/settings/swipe-actions",
    icon: "swipe",
  },
  {
    page: "playback",
    title: "Playback",
    route: "/settings/playback",
    icon: "play",
  },
  { page: "history", title: "Listening History", route: "/settings/history", icon: "history" },
  {
    page: "lyricsAndTags",
    title: "Lyrics and tags",
    route: "/settings/lyrics-and-tags",
    icon: "quote",
  },
  {
    page: "downloads",
    title: "Downloads",
    route: "/settings/downloads",
    icon: "download",
  },
  {
    page: "accounts",
    title: "Accounts",
    route: "/settings/accounts",
    icon: "user",
  },
  {
    page: "developer",
    title: "Developer",
    route: "/settings/developer",
    icon: "code",
  },
] as const satisfies readonly SettingsPageEntry[];

/** Settings lists Developer only after this phone's title-tap toggle is on. */
export const visibleSettingsPages = (developerVisible = false): readonly SettingsPageEntry[] =>
  SETTINGS_PAGES.filter(({ page }) => page !== "developer" || developerVisible);

/**
 * What Settings › Layout opens, by id: the options a long press opens on a
 * screen's title (Home, the Library, Playlists) or on the tab bar, each as a
 * page of its own.
 */
export type LayoutPage = "home" | "library" | "playlists" | "tabBar";

export interface LayoutPageEntry {
  readonly page: LayoutPage;
  /** What its row on the Layout page and its own header say. */
  readonly title: string;
  /** Where its screen is (also `wave://settings/layout/<…>`). */
  readonly route: `/settings/layout/${string}`;
}

/** Layout's pages, in the order its page lists them. */
export const LAYOUT_PAGES = [
  { page: "home", title: "Home", route: "/settings/layout/home" },
  { page: "library", title: "Library", route: "/settings/layout/library" },
  { page: "playlists", title: "Playlists", route: "/settings/layout/playlists" },
  { page: "tabBar", title: "Tab bar", route: "/settings/layout/tab-bar" },
] as const satisfies readonly LayoutPageEntry[];

/**
 * The Accounts row's line: the YT Music, Spotify and Wave accounts this phone
 * is signed into, by name (a Wave account without one by its email); null
 * when none is. A session that ended counts as signed out, as its page says.
 */
export const accountsSummary = (
  yt: YtSession,
  wave: WaveSession,
  spotify: SpotifySession = { status: "signedOut" },
): string | null => {
  const parts: string[] = [];
  if (yt.status === "signedIn") parts.push(`YT Music: ${yt.account.name}`);
  if (spotify.status === "signedIn") parts.push(`Spotify: ${spotify.account.name}`);
  if (wave.status === "signedIn") parts.push(`Wave: ${wave.account.name ?? wave.account.email}`);
  return parts.length === 0 ? null : parts.join(" · ");
};

/**
 * The Downloads row's line: how many songs are on their way while any are
 * ([queued], `queuedDownloadCounts`), then how many songs' downloads failed and
 * wait on its page (`failedDownloadCount`); null while none is either.
 */
export const downloadsSummary = (
  failed: number,
  queued: QueuedDownloadCounts = { downloading: 0, saving: 0, waiting: 0 },
): string | null => {
  const parts = [
    queuedDownloadsSummary(queued),
    failed === 0 ? null : `${counted(failed, "song")} failed`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
};
