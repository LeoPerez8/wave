/**
 * The actions Wave offers on library items, as one list shared by the
 * long-press menu (one item) and the selection bar (one or more checked
 * items), so a new menu entry shows up in selection too. Entries that only
 * make sense for a single target (Go to Album, Rename Playlist…) are offered
 * whenever the items still meet that condition.
 */

import {
  missingSongsDownloadActions,
  type MissingSongsDownloadAction,
} from "./missingSongDownload.ts";
import { isDetailPath } from "./navigation.ts";
import {
  libraryArtistKey,
  streamedArtistKeys,
  streamedArtistLink,
  type StreamedArtistContext,
  type StreamedArtistLink,
} from "./streamedArtist.ts";
import {
  YT_DOWNLOAD_ACTION_LABELS,
  ytDownloadActions,
  type YtDownloadStatus,
} from "./ytDownloads.ts";

/**
 * What kind of library item the actions are about. `mixed` is items of
 * several kinds checked together (an artist page's albums and songs): they
 * get only the entries every kind offers.
 */
export type ItemKind = "track" | "album" | "artist" | "playlist" | "genre" | "section" | "mixed";

/** The kind of items checked together: theirs when they're all one kind, otherwise `mixed`. */
export const commonKind = (kinds: readonly Exclude<ItemKind, "mixed">[]): ItemKind => {
  const first = kinds[0];
  return first !== undefined && kinds.every((kind) => kind === first) ? first : "mixed";
};

/** Where the actions show: an item's long-press menu, or the bar of a list in selection mode. */
export type ActionSurface = "menu" | "selection";

/** What the actions need to know about each item; kinds fill in what applies to them. */
export interface ActionItem {
  /** The item's album (a track's). */
  readonly albumId?: number | undefined;
  /**
   * The artists the item is credited to, primary first: each artist a track's
   * credit names, each album artist an album's credit names.
   */
  readonly artistIds?: readonly number[] | undefined;
  /**
   * A starred track, or a starred streamed song (a pending favorite, its
   * download asked for: a star means downloaded).
   */
  readonly favorite?: boolean | undefined;
  /** A track shown in a playlist, which it can be removed from. */
  readonly inPlaylist?: boolean | undefined;
  /**
   * A missing song: a track the Wave account has and this phone has no file
   * for. It can't be queued, deleted or written to, only downloaded or
   * removed from the Library.
   */
  readonly missing?: boolean | undefined;
  /** Where a missing song's download is (`ytDownloadStatus`); null or undefined when never asked for. */
  readonly download?: YtDownloadStatus | null | undefined;
  /** A playlist shown with an image of its own instead of its mosaic. */
  readonly hasImage?: boolean | undefined;
  /**
   * A YT Music song checked beside the Library's (Search, a playlist's
   * entry…): streamed, not a file. It joins the queue and playlists, can be
   * downloaded, and starred (which downloads it); what acts on files (Fix
   * Song, Delete) isn't for it.
   */
  readonly streamed?: boolean | undefined;
  /** A streamed song's artists, as YouTube Music credits them. */
  readonly artistNames?: readonly string[] | undefined;
  /** A streamed song the Library has a file of since it was listed: nothing left to download. */
  readonly downloaded?: boolean | undefined;
  /**
   * A playlist's unsearched entry (a song a Spotify import listed, not
   * searched yet), streamed as a YT Music entry is: it queues, joins
   * playlists and downloads (its download searches it first). It has no
   * video to star yet, so songs checked with it offer no Favorite.
   */
  readonly unsearched?: boolean | undefined;
  /**
   * A song Fix Song can do something for: it lacks lyrics, a track number, a
   * year, a genre or a checked explicit flag (`canFixSong`).
   */
  readonly fixable?: boolean | undefined;
  /**
   * An album's missing songs, each as where its download is (null when never
   * asked for): the album offers to download them.
   */
  readonly missingSongs?: readonly (YtDownloadStatus | null)[] | undefined;
  /**
   * A collection's songs (an album's, artist's, playlist's or genre's), each
   * as a song's facts: Fix Songs runs on those that are files missing
   * something, so one of them is enough to offer it.
   */
  readonly songs?: readonly ActionItem[] | undefined;
}

/** A Library artist, as streamed songs' artists resolve to them. */
export interface LibraryArtistRef {
  readonly id: number;
  readonly name: string;
}

/**
 * What tells a streamed song's artists apart (Core's `streamedArtistLink`,
 * the page you're on aside): which names the Library has, and whether YT
 * Music is on.
 */
export type StreamedArtists<A extends LibraryArtistRef> = Omit<StreamedArtistContext<A>, "here">;

export interface ActionSubject<A extends LibraryArtistRef = LibraryArtistRef> {
  readonly kind: ItemKind;
  /** The items acted on: one for a menu, the checked ones (in list order) for the bar. */
  readonly items: readonly ActionItem[];
  /** Defaults to the menu. */
  readonly surface?: ActionSurface | undefined;
  /** The menu was opened from a list that can select: it offers Select. */
  readonly selectable?: boolean | undefined;
  /** Settings allows looking songs up online: songs missing something offer Fix Song. */
  readonly onlineLookups?: boolean | undefined;
  /** The current route, so Go to doesn't lead to the page you're on. */
  readonly here: string;
  /**
   * How streamed songs' artists resolve, so Go to Artist can offer the
   * artists they share with the other items; without it, they offer none.
   */
  readonly streamedArtists?: StreamedArtists<A> | undefined;
  /**
   * A service a playlist can be shared on is on (`playlistShareServices`):
   * a playlist's menu offers Share.
   */
  readonly sharing?: boolean | undefined;
}

export type ItemAction =
  | "playNext"
  | "addToQueue"
  | "magicQueue"
  | "addToPlaylist"
  | "favorite"
  | "unfavorite"
  | "removeFromPlaylist"
  | "goToAlbum"
  | "goToArtist"
  | "renamePlaylist"
  | "changeImage"
  | "adjustImage"
  | "removeImage"
  | "share"
  | "deletePlaylist"
  | "deletePlaylists"
  | "fixSong"
  | "fixSongs"
  | "select"
  | "delete"
  | "removeFromLibrary"
  | "download"
  | "cancelDownload"
  | "retryDownload"
  | "downloadMissingSongs"
  | "retryFailed";

/**
 * Where a link to an item's artists leads (Go to Artist, Now Playing's artist
 * line): straight to the one artist, or a choice of several.
 */
export type ArtistLink =
  | { readonly kind: "open"; readonly artistId: number }
  | { readonly kind: "choose"; readonly artistIds: readonly number[] };

/**
 * One entry, in the order shown; Go to entries carry where they lead. Go to
 * Artist on items that include streamed songs leads where a streamed song's
 * artist link does (`streamedArtistLink`).
 */
export type ItemActionEntry<A extends LibraryArtistRef = LibraryArtistRef> =
  | { readonly action: Exclude<ItemAction, "goToAlbum" | "goToArtist"> }
  | { readonly action: "goToAlbum"; readonly albumId: number }
  | { readonly action: "goToArtist"; readonly artists: ArtistLink }
  | {
      readonly action: "goToArtist";
      readonly streamedArtists: Exclude<StreamedArtistLink<A>, { readonly kind: "here" }>;
    };

/** What each entry says. */
export const ITEM_ACTION_LABELS: { readonly [A in ItemAction]: string } = {
  playNext: "Play Next",
  addToQueue: "Add to Queue",
  magicQueue: "Magic Queue",
  addToPlaylist: "Add to Playlist",
  favorite: "Favorite",
  unfavorite: "Remove from Favorites",
  removeFromPlaylist: "Remove from Playlist",
  goToAlbum: "Go to Album",
  goToArtist: "Go to Artist",
  renamePlaylist: "Rename Playlist",
  changeImage: "Change Image",
  adjustImage: "Adjust Image",
  removeImage: "Remove Image",
  share: "Share",
  deletePlaylist: "Delete Playlist",
  deletePlaylists: "Delete Playlists",
  fixSong: "Fix Song",
  fixSongs: "Fix Songs",
  select: "Select",
  delete: "Delete",
  removeFromLibrary: "Remove from Library",
  ...YT_DOWNLOAD_ACTION_LABELS,
  downloadMissingSongs: "Download Missing Songs",
  retryFailed: "Retry Failed",
};

/**
 * Entries that delete something for good, shown in the destructive colour:
 * a song's file, a song from the Library, a playlist (its menu's Delete
 * Playlist) or several (the selection bar's Delete Playlists).
 */
export const isDestructiveAction = (action: ItemAction): boolean =>
  action === "delete" ||
  action === "removeFromLibrary" ||
  action === "deletePlaylist" ||
  action === "deletePlaylists";

/**
 * Entries that ask before acting: selection mode stays until the question is
 * answered, so Cancel leaves the checked items as they were.
 */
export const confirmsFirst = (action: ItemAction): boolean =>
  action === "delete" ||
  action === "removeFromLibrary" ||
  action === "deletePlaylist" ||
  action === "deletePlaylists";

/**
 * A song with no file here yet (missing, or streamed, an unsearched one
 * included): Download fetches it.
 */
const needsDownload = (item: ActionItem): boolean =>
  item.missing === true || (item.streamed === true && item.downloaded !== true);

/** The value every item has, or undefined when they differ or any lacks one. */
const shared = (values: readonly (number | undefined)[]): number | undefined => {
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : undefined;
};

/**
 * Where a link to artists [artistIds] (an item's, primary first) leads from
 * the page [here]: the page you're on is left out, a single artist opens
 * straight away, several are a choice. Undefined when none is left.
 */
export const artistLink = (artistIds: readonly number[], here: string): ArtistLink | undefined => {
  const offered = [...new Set(artistIds)].filter((id) => !isDetailPath(here, "artist", id));
  const [first] = offered;
  if (first === undefined) return undefined;
  return offered.length === 1
    ? { kind: "open", artistId: first }
    : { kind: "choose", artistIds: offered };
};

/** The artists every item is credited to, as the first lists them; none when they differ. */
const sharedArtists = (items: readonly ActionItem[]): readonly number[] => {
  const first = items[0]?.artistIds ?? [];
  const set = new Set(first);
  const same = (ids: readonly number[] | undefined): boolean =>
    ids !== undefined &&
    ids.length > 0 &&
    new Set(ids).size === set.size &&
    ids.every((id) => set.has(id));
  return items.every((item) => same(item.artistIds)) ? first : [];
};

/**
 * Go to Artist on items that include streamed songs: when every item is by
 * the same artists (a streamed song's names resolved as its menu resolves
 * them), it leads where the first streamed song's link does. None with YT
 * Music off, as a streamed song's menu has none.
 */
const streamedGoToArtist = <A extends LibraryArtistRef>(
  items: readonly ActionItem[],
  { here, streamedArtists: context }: ActionSubject<A>,
): ItemActionEntry<A> | undefined => {
  if (context === undefined || !context.enabled) return undefined;
  const keysOf = (item: ActionItem): ReadonlySet<string> =>
    new Set(
      item.streamed === true
        ? streamedArtistKeys(item.artistNames ?? [], context.libraryArtist)
        : (item.artistIds ?? []).map(libraryArtistKey),
    );
  const [first, ...rest] = items.map(keysOf);
  if (first === undefined || first.size === 0) return undefined;
  const same = (keys: ReadonlySet<string>): boolean =>
    keys.size === first.size && [...keys].every((key) => first.has(key));
  if (!rest.every(same)) return undefined;
  const lead = items.find((item) => item.streamed === true);
  const link = streamedArtistLink(lead?.artistNames ?? [], { ...context, here });
  return link === undefined || link.kind === "here"
    ? undefined
    : { action: "goToArtist", streamedArtists: link };
};

/** An album's download entries, by what each stands for in Settings' Download All. */
const ALBUM_DOWNLOAD_ACTIONS: {
  readonly [A in MissingSongsDownloadAction]:
    "downloadMissingSongs" | "retryFailed" | "cancelDownload";
} = {
  downloadAll: "downloadMissingSongs",
  retryFailed: "retryFailed",
  cancel: "cancelDownload",
};

/** The kinds whose items hold songs Fix Songs can run on. */
export type CollectionKind = Extract<ItemKind, "album" | "artist" | "playlist" | "genre">;

const COLLECTIONS: ReadonlySet<ItemKind> = new Set<CollectionKind>([
  "album",
  "artist",
  "playlist",
  "genre",
]);

/** Whether [kind]'s items hold songs (an album, artist, playlist or genre). */
export const isCollectionKind = (kind: ItemKind): kind is CollectionKind => COLLECTIONS.has(kind);

/** A song that's a Library file Fix Song can do something for. */
const fixableFile = (song: ActionItem): boolean =>
  song.fixable === true && song.missing !== true && song.streamed !== true;

/**
 * Whether a menu starts a Magic Queue from its item: one Library song with a
 * file here, album, artist or playlist (the seeds a Magic Queue grows from
 * the Library); not a genre, nor the selection bar.
 */
const offersMagicQueue = (
  kind: ItemKind,
  items: readonly ActionItem[],
  surface: ActionSurface,
): boolean => {
  const [only] = items;
  if (surface !== "menu" || items.length !== 1 || only === undefined) return false;
  if (kind === "track") return only.missing !== true && only.streamed !== true;
  return kind === "album" || kind === "artist" || kind === "playlist";
};

/** The entries to offer on [subject]'s items, in order. */
export const itemActions = <A extends LibraryArtistRef = LibraryArtistRef>(
  subject: ActionSubject<A>,
): ItemActionEntry<A>[] => {
  const { kind, items, here } = subject;
  if (items.length === 0) return [];
  const surface = subject.surface ?? "menu";
  // Missing songs have no file: they don't play, and there's none to delete or write to.
  const missing = items.filter((item) => item.missing === true).length;
  // Streamed songs have no file either: starring one downloads it, and there's none to delete.
  const streamed = items.filter((item) => item.streamed === true).length;
  const files = items.length - missing - streamed;
  const [only] = items;
  // A missing song's menu leads with its download, as a YT Music song's offers it.
  const download =
    surface === "menu" && kind === "track" && items.length === 1 && only?.missing === true
      ? ytDownloadActions(only.download ?? null, { inLibrary: false })
      : [];
  const entries: ItemActionEntry<A>[] = [
    ...download.map((action) => ({ action })),
    ...(missing < items.length
      ? [{ action: "playNext" } as const, { action: "addToQueue" } as const]
      : []),
    ...(offersMagicQueue(kind, items, surface) ? [{ action: "magicQueue" } as const] : []),
    { action: "addToPlaylist" },
  ];
  // Albums' missing songs download as Settings' Download All does them, only theirs.
  if (kind === "album")
    entries.push(
      ...missingSongsDownloadActions(items.flatMap((item) => item.missingSongs ?? [])).map(
        (action) => ({ action: ALBUM_DOWNLOAD_ACTIONS[action] }),
      ),
    );
  if (kind === "track") {
    if (!items.some((item) => item.unsearched === true))
      entries.push({ action: items.every((item) => item.favorite) ? "unfavorite" : "favorite" });
    if (items.every((item) => item.inPlaylist)) entries.push({ action: "removeFromPlaylist" });
  }
  // In selection, Download fetches the checked songs that aren't the Library's files yet.
  if (surface === "selection" && kind === "track" && items.some(needsDownload))
    entries.push({ action: "download" });
  const albumId = shared(items.map((item) => item.albumId));
  if (albumId !== undefined && !isDetailPath(here, "album", albumId))
    entries.push({ action: "goToAlbum", albumId });
  if (streamed > 0) {
    const goToArtist = streamedGoToArtist(items, subject);
    if (goToArtist !== undefined) entries.push(goToArtist);
  } else {
    const artists = artistLink(sharedArtists(items), here);
    if (artists !== undefined) entries.push({ action: "goToArtist", artists });
  }
  if (kind === "playlist" && items.length === 1) {
    entries.push({ action: "renamePlaylist" });
    // Its own image is set from its menu (the selection bar leaves it out); the mosaic shows without one.
    if (surface === "menu") {
      entries.push({ action: "changeImage" });
      // Adjust Image reframes it from the original photo, at the last framing.
      if (only?.hasImage === true)
        entries.push({ action: "adjustImage" }, { action: "removeImage" });
      // Shared as a playlist on another service, from its menu alone (#483).
      if (subject.sharing === true) entries.push({ action: "share" });
    }
  }
  // Looks up online what the songs lack and writes it into their files; it
  // works on the checked songs missing something, so one of them is enough.
  if (
    kind === "track" &&
    subject.onlineLookups === true &&
    files === items.length &&
    items.some((item) => item.fixable === true)
  )
    entries.push({ action: items.length === 1 ? "fixSong" : "fixSongs" });
  // A collection's songs the same way: only its Library files count (not its
  // missing songs, nor a playlist's streamed entries), so it runs on those.
  if (
    isCollectionKind(kind) &&
    subject.onlineLookups === true &&
    items.some((item) => (item.songs ?? []).some(fixableFile))
  )
    entries.push({ action: "fixSongs" });
  if (kind === "playlist")
    entries.push({ action: items.length === 1 ? "deletePlaylist" : "deletePlaylists" });
  // One song's menu shares it as a card (the song share sheet), whatever kind of song it is.
  if (surface === "menu" && kind === "track" && items.length === 1)
    entries.push({ action: "share" });
  if (surface === "menu" && subject.selectable === true) entries.push({ action: "select" });
  // Last, and destructive (after asking): deletes the songs' files from the
  // phone, or takes missing songs out of the Library.
  if (kind === "track" && files === items.length) entries.push({ action: "delete" });
  if (kind === "track" && missing === items.length) entries.push({ action: "removeFromLibrary" });
  return entries;
};

/** One entry of a YT Music song's menu; Go to entries carry where they lead. */
export type YtSongActionEntry<A> =
  | {
      readonly action:
        | "playNext"
        | "addToQueue"
        | "addToPlaylist"
        | "favorite"
        | "unfavorite"
        | "removeFromPlaylist"
        | "share"
        | "select";
    }
  /** The song's YT Music album page, by its browse id (`MPREb_…`). */
  | { readonly action: "goToAlbum"; readonly album: string }
  | {
      readonly action: "goToArtist";
      readonly artists: Exclude<StreamedArtistLink<A>, { readonly kind: "here" }>;
    };

/** What a YT Music song's menu needs to know besides where its artists lead. */
export interface YtSongActionOptions {
  /** Shown in a playlist, which it can be removed from. */
  readonly inPlaylist?: boolean | undefined;
  /**
   * Whether the song is starred (a pending favorite, or the Library's song
   * it is by now): it offers Remove from Favorites, else Favorite, which
   * downloads it. Absent, it offers neither.
   */
  readonly favorite?: boolean | undefined;
  /** The browse id (`MPREb_…`) of the song's YT Music album, when it has one. */
  readonly album?: string | null | undefined;
  /** The browse id of the YT Music album page you're on, so Go to Album doesn't lead to it. */
  readonly ytAlbumHere?: string | null | undefined;
  /** Whether YT Music is on in Settings: an album page asks YouTube, so off, there's no Go to Album. */
  readonly ytMusic?: boolean | undefined;
  /** The menu was opened from a list that can select: it offers Select. */
  readonly selectable?: boolean | undefined;
}

/**
 * The entries a YT Music song's long-press menu offers: it can join the
 * queue and playlists beside the Library's songs; it can be starred as a
 * Library song is ([favorite]), the star downloading it; shown in a playlist
 * ([inPlaylist]), it can leave it too; with YT Music on, Go to Album opens
 * its YT Music [album] page (none on that page, or for a song without an
 * album); and, given where its [artists] link leads (Core's
 * `streamedArtistLink`), Go to Artist opens them integrated (none when its
 * only artist is the page you're on); last, Select, opened from a list that
 * can select ([selectable]). The Library's other entries (Fix Song, Delete)
 * are about its files, which a streamed song isn't.
 */
export const ytSongActions = <A>(
  artists?: StreamedArtistLink<A>,
  {
    inPlaylist = false,
    favorite,
    album,
    ytAlbumHere,
    ytMusic = false,
    selectable = false,
  }: YtSongActionOptions = {},
): YtSongActionEntry<A>[] => [
  { action: "playNext" },
  { action: "addToQueue" },
  { action: "addToPlaylist" },
  ...(favorite === undefined ? [] : [{ action: favorite ? "unfavorite" : "favorite" } as const]),
  ...(inPlaylist ? [{ action: "removeFromPlaylist" } as const] : []),
  ...(ytMusic && album !== undefined && album !== null && album !== "" && album !== ytAlbumHere
    ? [{ action: "goToAlbum", album } as const]
    : []),
  ...(artists === undefined || artists.kind === "here"
    ? []
    : [{ action: "goToArtist", artists } as const]),
  { action: "share" },
  ...(selectable ? [{ action: "select" } as const] : []),
];

/**
 * What items are mostly selected for, Delete and Remove from Library
 * (songs), and Download Missing Songs (albums): always a button of their own
 * on the bar, never behind More.
 */
const KEPT_ON_BAR: ReadonlySet<ItemAction> = new Set<ItemAction>([
  "playNext",
  "addToQueue",
  "addToPlaylist",
  "favorite",
  "unfavorite",
  "removeFromPlaylist",
  "delete",
  "removeFromLibrary",
  "downloadMissingSongs",
]);

/**
 * Shorter captions for labels too long for a bar button (whose accessibility
 * label stays the full one). "Unfavorite" is wider than a button of a
 * seven-button bar: its soft hyphen lets it break into two lines there.
 */
const BAR_LABELS: { readonly [A in ItemAction]?: string } = {
  unfavorite: "Un­favorite",
  removeFromPlaylist: "Remove",
  downloadMissingSongs: "Download",
};

/** A bar button's caption for [action]. */
export const actionBarLabel = (action: ItemAction): string =>
  BAR_LABELS[action] ?? ITEM_ACTION_LABELS[action];

/**
 * Fits entries into a bar of [slots] buttons: all of them when they fit,
 * otherwise a More button (the last slot) holding the rest. The primary
 * actions (queue, add to a playlist, favorite, remove from the playlist) and
 * Delete always keep a button, the bar growing past [slots] if they need it
 * (a playlist's songs: six, and More); other entries fill what's left before
 * More, in order.
 */
export const splitActionBar = <T extends { readonly action: ItemAction }>(
  entries: readonly T[],
  slots: number,
): { readonly bar: T[]; readonly more: T[] } => {
  if (entries.length <= slots) return { bar: [...entries], more: [] };
  const kept = entries.filter((entry) => KEPT_ON_BAR.has(entry.action)).length;
  let spare = Math.max(0, slots - 1 - kept);
  const bar: T[] = [];
  const more: T[] = [];
  for (const entry of entries) {
    if (KEPT_ON_BAR.has(entry.action)) bar.push(entry);
    else if (spare > 0) {
      bar.push(entry);
      spare -= 1;
    } else more.push(entry);
  }
  return { bar, more };
};
