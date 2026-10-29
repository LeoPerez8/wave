/**
 * Settings is a short list of rows, each opening a page of its own with the
 * settings of one area. Add a page here (its id, the title its row and header
 * show, the route its screen lives at, and its row's glyph), then give it a
 * screen under `app/settings/` and, if it helps, a summary line.
 */

import { en, type Catalogue } from "./catalogueEn.ts";
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
  | "followedArtists"
  | "lyricsAndTags"
  | "downloads"
  | "accounts"
  | "developer";

/**
 * A Settings row's glyph, by name; the app draws each with a Tabler line icon
 * (`settings/SettingsGlyph.tsx`).
 */
export type SettingsIcon =
  | "history"
  | "userCheck"
  | "books"
  | "palette"
  | "layout"
  | "swipe"
  | "play"
  | "quote"
  | "download"
  | "user"
  | "code";

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
  { page: "library", title: en.settings.pages.library, route: "/settings/library", icon: "books" },
  {
    page: "appearance",
    title: en.settings.pages.appearance,
    route: "/settings/appearance",
    icon: "palette",
  },
  { page: "layout", title: en.settings.pages.layout, route: "/settings/layout", icon: "layout" },
  {
    page: "swipeActions",
    title: en.settings.pages.swipeActions,
    route: "/settings/swipe-actions",
    icon: "swipe",
  },
  {
    page: "playback",
    title: en.settings.pages.playback,
    route: "/settings/playback",
    icon: "play",
  },
  {
    page: "history",
    title: en.settings.pages.history,
    route: "/settings/history",
    icon: "history",
  },
  {
    page: "followedArtists",
    title: en.settings.pages.followedArtists,
    route: "/settings/followed-artists",
    icon: "userCheck",
  },
  {
    page: "lyricsAndTags",
    title: en.settings.pages.lyricsAndTags,
    route: "/settings/lyrics-and-tags",
    icon: "quote",
  },
  {
    page: "downloads",
    title: en.settings.pages.downloads,
    route: "/settings/downloads",
    icon: "download",
  },
  {
    page: "accounts",
    title: en.settings.pages.accounts,
    route: "/settings/accounts",
    icon: "user",
  },
  {
    page: "developer",
    title: en.settings.pages.developer,
    route: "/settings/developer",
    icon: "code",
  },
] as const satisfies readonly SettingsPageEntry[];

/** Settings lists Developer only after this phone's title-tap toggle is on. */
export const visibleSettingsPages = (
  developerVisible = false,
  catalogue: Catalogue = en,
): readonly SettingsPageEntry[] =>
  SETTINGS_PAGES.filter(({ page }) => page !== "developer" || developerVisible).map((entry) => ({
    ...entry,
    title: catalogue.settings.pages[entry.page],
  }));

/**
 * What Settings › Layout opens, by id: the options a long press opens on a
 * screen's title (Home, the Library, Playlists) or on the tab bar, each as a
 * page of its own.
 */
export type LayoutPage = "home" | "library" | "playlists" | "tabBar" | "nowPlaying";

export interface LayoutPageEntry {
  readonly page: LayoutPage;
  /** What its row on the Layout page and its own header say. */
  readonly title: string;
  /** Where its screen is (also `wave://settings/layout/<…>`). */
  readonly route: `/settings/layout/${string}`;
}

/** Layout's pages, in the order its page lists them. */
export const LAYOUT_PAGES = [
  { page: "home", title: en.settings.layoutPages.home, route: "/settings/layout/home" },
  { page: "library", title: en.settings.layoutPages.library, route: "/settings/layout/library" },
  {
    page: "playlists",
    title: en.settings.layoutPages.playlists,
    route: "/settings/layout/playlists",
  },
  { page: "tabBar", title: en.settings.layoutPages.tabBar, route: "/settings/layout/tab-bar" },
  {
    page: "nowPlaying",
    title: en.settings.layoutPages.nowPlaying,
    route: "/settings/layout/now-playing",
  },
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
  catalogue: Catalogue = en,
): string | null => {
  const parts = [
    queuedDownloadsSummary(queued, catalogue),
    failed === 0 ? null : catalogue.downloadStatus.failedSongs(failed),
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
};
