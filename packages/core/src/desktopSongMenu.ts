/**
 * The desktop's song menu and selection bar (docs/spec-desktop.md, Look and feel): the phone's
 * `itemActions` for songs, keeping the entries the desktop offers. A song's file stays on the
 * computer, so the phone's Delete is the desktop's Remove from Library, for every song.
 */

import {
  itemActions,
  type ActionItem,
  type ActionSurface,
  type ItemAction,
  type ItemActionEntry,
} from "./itemActions.ts";

/** The entries a desktop song menu can hold; Share is its Copy Link. */
const OFFERED: ReadonlySet<ItemAction> = new Set<ItemAction>([
  "playNext",
  "addToQueue",
  "magicQueue",
  "addToPlaylist",
  "favorite",
  "unfavorite",
  "goToAlbum",
  "goToArtist",
  "fixSong",
  "fixSongs",
  "share",
  "select",
]);

export interface DesktopSongSubject {
  /** One song for a menu, the checked ones (in list order) for the selection bar. */
  readonly items: readonly ActionItem[];
  /** Defaults to the menu. */
  readonly surface?: ActionSurface | undefined;
  /** The menu was opened from a list that can select: it offers Select. */
  readonly selectable?: boolean | undefined;
  /** The album's or artist's page the songs are listed on, so Go to doesn't lead back to it. */
  readonly page?: { readonly kind: "album" | "artist"; readonly id: number } | undefined;
  /** YouTube Music is on: one song's menu starts a Magic Queue. */
  readonly ytMusic?: boolean | undefined;
  /** Online lookups are on: songs missing something offer Fix Song. */
  readonly onlineLookups?: boolean | undefined;
  /** Share links are on: one song's menu offers Copy Link. */
  readonly copyLink?: boolean | undefined;
}

/** The entries to offer on [subject]'s songs, in the phone's order. */
export const desktopSongActions = (subject: DesktopSongSubject): ItemActionEntry[] => {
  const { items, page } = subject;
  if (items.length === 0) return [];
  const entries = itemActions({
    kind: "track",
    items,
    surface: subject.surface,
    selectable: subject.selectable,
    ytMusic: subject.ytMusic === true,
    onlineLookups: subject.onlineLookups,
    here: page === undefined ? "/library" : `/library/${page.kind}/${page.id}`,
  }).filter(
    (entry) => OFFERED.has(entry.action) && (entry.action !== "share" || subject.copyLink === true),
  );
  // Streamed songs have no Library entry to take out.
  return items.some((item) => item.streamed === true)
    ? entries
    : [...entries, { action: "removeFromLibrary" }];
};
