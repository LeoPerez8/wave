/**
 * The desktop's song menu and selection bar (docs/spec-desktop.md, Look and feel): the phone's
 * `itemActions` for songs, keeping the entries the desktop offers. A song's file stays on the
 * computer, so the phone's Delete is the desktop's Remove from Library, for every song.
 */

import {
  commonKind,
  itemActions,
  needsDownload,
  type ActionItem,
  type ActionSurface,
  type CollectionKind,
  type ItemAction,
  type ItemActionEntry,
} from "./itemActions.ts";

/**
 * The entries a desktop song menu can hold; Share opens its submenu, Release Date its dialog. A
 * playlist's songs can leave it.
 */
const OFFERED: ReadonlySet<ItemAction> = new Set<ItemAction>([
  "download",
  "playNext",
  "addToQueue",
  "magicQueue",
  "addToPlaylist",
  "removeFromPlaylist",
  "favorite",
  "unfavorite",
  "goToAlbum",
  "goToArtist",
  "fixSong",
  "fixSongs",
  "releaseDate",
  "share",
  "select",
]);

/**
 * One entry of a desktop song menu: the phone's (`ItemActionEntry`), or the desktop's own Show in
 * Folder, which opens the file manager on the song's file.
 */
export type DesktopSongEntry = ItemActionEntry | { readonly action: "showInFolder" };

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
  /** The song can be shared (a Library song): one song's menu offers Share. */
  readonly share?: boolean | undefined;
}

/** The entries to offer on [subject]'s songs, in the phone's order. */
export const desktopSongActions = (subject: DesktopSongSubject): DesktopSongEntry[] => {
  const { items, page } = subject;
  if (items.length === 0) return [];
  const entries: DesktopSongEntry[] = itemActions({
    kind: "track",
    items,
    surface: subject.surface,
    selectable: subject.selectable,
    ytMusic: subject.ytMusic === true,
    onlineLookups: subject.onlineLookups,
    here: page === undefined ? "/library" : `/library/${page.kind}/${page.id}`,
  }).filter(
    (entry) => OFFERED.has(entry.action) && (entry.action !== "share" || subject.share === true),
  );
  // One song with a file here opens the file manager on it, before Select.
  const [only] = items;
  if (
    (subject.surface ?? "menu") === "menu" &&
    items.length === 1 &&
    only?.missing !== true &&
    only?.streamed !== true
  ) {
    const at = entries.findIndex((entry) => entry.action === "select");
    entries.splice(at === -1 ? entries.length : at, 0, { action: "showInFolder" });
  }
  // Streamed songs have no Library entry to take out.
  return items.some((item) => item.streamed === true)
    ? entries
    : [...entries, { action: "removeFromLibrary" }];
};

/** A checked item of a desktop selection: a song, or a collection with its songs' facts. */
export interface DesktopSelectionItem extends ActionItem {
  readonly kind: "track" | CollectionKind;
}

/** The entries the desktop runs on collections checked together, or with songs. */
const SELECTION_OFFERED: ReadonlySet<ItemAction> = new Set<ItemAction>([
  "playNext",
  "addToQueue",
  "addToPlaylist",
  "fixSongs",
]);

/**
 * The selection bar's entries for songs, albums, artists, genres and playlists checked together,
 * by the phone's rules (`itemActions`): songs alone keep theirs, one kind of collection offers
 * what that kind does, and mixed kinds only what every kind shares. Download joins them while
 * a song they hold has no file yet.
 */
export const desktopSelectionActions = (subject: {
  /** The checked items, in page order. */
  readonly items: readonly DesktopSelectionItem[];
  readonly onlineLookups?: boolean | undefined;
  readonly ytMusic?: boolean | undefined;
}): ItemActionEntry[] => {
  const { items } = subject;
  const kind = commonKind(items.map((item) => item.kind));
  // The bar never holds Show in Folder: it is one song's.
  if (kind === "track")
    return desktopSongActions({ ...subject, surface: "selection" }).filter(
      (entry): entry is ItemActionEntry => entry.action !== "showInFolder",
    );
  const entries = itemActions({
    kind,
    items,
    surface: "selection",
    ytMusic: subject.ytMusic === true,
    onlineLookups: subject.onlineLookups,
    here: "/library",
  }).filter((entry) => SELECTION_OFFERED.has(entry.action));
  const download = items.some((item) =>
    item.kind === "track" ? needsDownload(item) : (item.songs ?? []).some(needsDownload),
  );
  if (!download) return entries;
  const at = entries.findIndex((entry) => entry.action === "addToPlaylist") + 1;
  return [...entries.slice(0, at), { action: "download" }, ...entries.slice(at)];
};
