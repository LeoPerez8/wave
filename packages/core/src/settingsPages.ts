/**
 * Settings is a short list of rows, each opening a page of its own with the
 * settings of one area. Add a page here (its id, the title its row and header
 * show, and the route its screen lives at), then give it a screen under
 * `app/settings/` and, if it helps, a summary line.
 */

import { counted } from "./listening.ts";
import type { WaveSession } from "./waveAccount.ts";
import type { YtSession } from "./ytAccount.ts";

/** Each Settings page, by id. */
export type SettingsPage =
  | "library"
  | "appearance"
  | "layout"
  | "playback"
  | "lyricsAndTags"
  | "downloads"
  | "accounts"
  | "developer";

export interface SettingsPageEntry {
  readonly page: SettingsPage;
  /** What its row in Settings and its own header say. */
  readonly title: string;
  /** Where its screen is (also `wave://settings/<…>`). */
  readonly route: `/settings/${string}`;
}

/** The pages, in the order Settings lists them. */
export const SETTINGS_PAGES: readonly SettingsPageEntry[] = [
  { page: "library", title: "Library", route: "/settings/library" },
  { page: "appearance", title: "Appearance", route: "/settings/appearance" },
  { page: "layout", title: "Layout", route: "/settings/layout" },
  { page: "playback", title: "Playback", route: "/settings/playback" },
  { page: "lyricsAndTags", title: "Lyrics and tags", route: "/settings/lyrics-and-tags" },
  { page: "downloads", title: "Downloads", route: "/settings/downloads" },
  { page: "accounts", title: "Accounts", route: "/settings/accounts" },
  { page: "developer", title: "Developer", route: "/settings/developer" },
];

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
export const LAYOUT_PAGES: readonly LayoutPageEntry[] = [
  { page: "home", title: "Home", route: "/settings/layout/home" },
  { page: "library", title: "Library", route: "/settings/layout/library" },
  { page: "playlists", title: "Playlists", route: "/settings/layout/playlists" },
  { page: "tabBar", title: "Tab bar", route: "/settings/layout/tab-bar" },
];

/**
 * The Accounts row's line: the YT Music and Wave accounts this phone is
 * signed into, by name (a Wave account without one by its email); null when
 * neither is. A session that ended counts as signed out, as its page says.
 */
export const accountsSummary = (yt: YtSession, wave: WaveSession): string | null => {
  const parts: string[] = [];
  if (yt.status === "signedIn") parts.push(`YT Music: ${yt.account.name}`);
  if (wave.status === "signedIn") parts.push(`Wave: ${wave.account.name ?? wave.account.email}`);
  return parts.length === 0 ? null : parts.join(" · ");
};

/**
 * The Downloads row's line: how many songs' downloads failed and wait on its
 * page (`failedDownloads`); null while none has.
 */
export const downloadsSummary = (failed: number): string | null =>
  failed === 0 ? null : `${counted(failed, "song")} failed`;
