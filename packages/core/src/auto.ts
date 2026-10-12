/**
 * Wave's browse tree in Android Auto: which nodes exist, how their media IDs
 * read, what each node's children are (page by page) and what playing a node
 * starts. The app fetches the library rows a node lists and hands the start to
 * the queue engine, so the car and the phone share one set of playback rules.
 *
 * Extending the tree:
 * - a tab: add it to `AUTO_TABS` and `TAB_TITLES`, and describe its children in
 *   `tabChildren` (fixed items and/or an `AutoSource`);
 * - a track list (something with a Shuffle item and tracks that play it as
 *   their context): add its kind to `AutoTrackListKind` and `TRACK_LISTS`;
 * - another browsable node (say, an artist): add an `AutoNode` variant, its
 *   segments in `encodeAutoMediaId`/`decodeAutoMediaId`, its children in
 *   `listing` and, if it plays, its list in `autoPlayList`;
 * - an explicit item for a list with nothing in it: its titles in `emptyTitles`.
 *
 * The app side (`apps/mobile/src/auto/Auto.ts`) loads a source's rows in
 * `fetch` and a track list's songs in `listSongs`.
 */

import type { QueueContext } from "./queue.ts";
import { compareAlbumTracks } from "./library.ts";

/** Auto's tabs: the root's children, in order. */
export type AutoTab = "home" | "playlists" | "albums" | "artists";

export const AUTO_TABS: readonly AutoTab[] = ["home", "playlists", "albums", "artists"];

const TAB_TITLES: Record<AutoTab, string> = {
  home: "Home",
  playlists: "Playlists",
  albums: "Albums",
  artists: "Artists",
};

/** A track as a track list needs it: shown in Auto, ordered, and played. */
export interface AutoTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
  readonly titleSort: string;
  readonly path: string;
}

/** The kinds of track list Auto can open or play. */
export type AutoTrackListKind = "album" | "playlist";

/**
 * A list of tracks Auto plays as one context: its Shuffle item plays it
 * shuffled, and each track plays it from that track. `id` is the list's id
 * within its kind (an album id).
 */
export interface AutoTrackList {
  readonly kind: AutoTrackListKind;
  readonly id: string;
}

interface TrackListKind {
  /** The play context the app uses for the same list. */
  readonly context: (id: string) => QueueContext;
  /** The list's tracks in list order (a new array). */
  readonly order: (tracks: readonly AutoTrack[]) => readonly AutoTrack[];
}

/** One entry per track list kind; the media ID segment is the kind itself. */
const TRACK_LISTS: Record<AutoTrackListKind, TrackListKind> = {
  album: {
    context: (id) => ({ kind: "album", id }),
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    order: (tracks) => [...tracks].sort(compareAlbumTracks),
  },
  playlist: {
    context: (id) => ({ kind: "playlist", id }),
    // The app loads a playlist's tracks in playlist order already.
    order: (tracks) => [...tracks],
  },
};

const isTrackListKind = (kind: string): kind is AutoTrackListKind =>
  Object.prototype.hasOwnProperty.call(TRACK_LISTS, kind);

/** A node of the browse tree, as its media ID says. */
export type AutoNode =
  | { readonly type: "root" }
  | { readonly type: "tab"; readonly tab: AutoTab }
  /** A track list to open: Shuffle, then its tracks. */
  | { readonly type: "list"; readonly list: AutoTrackList }
  /** Plays the list shuffled. */
  | { readonly type: "shuffle"; readonly list: AutoTrackList }
  /**
   * Plays the list from its track at `index` (in list order); `trackId`
   * checks it is still that track.
   */
  | {
      readonly type: "track";
      readonly list: AutoTrackList;
      readonly index: number;
      readonly trackId: string;
    }
  /** What a list shows when it has nothing to list (`autoPageItems`); does nothing. */
  | { readonly type: "empty"; readonly parent: AutoNode };

const ROOT_ID = "root";

/**
 * The node's media ID: `/`-separated segments, each one URI-encoded, e.g.
 * `tab/albums`, `album/12`, `album/12/shuffle`, `album/12/track/3/456`.
 */
export const encodeAutoMediaId = (node: AutoNode): string => {
  if (node.type === "empty") return `${encodeAutoMediaId(node.parent)}/${EMPTY}`;
  const segments = ((): readonly string[] => {
    switch (node.type) {
      case "root":
        return [ROOT_ID];
      case "tab":
        return ["tab", node.tab];
      case "list":
        return [node.list.kind, node.list.id];
      case "shuffle":
        return [node.list.kind, node.list.id, "shuffle"];
      case "track":
        return [node.list.kind, node.list.id, "track", String(node.index), node.trackId];
    }
  })();
  return segments.map(encodeURIComponent).join("/");
};

/** The last segment of an empty item's media ID, after its list's: `tab/playlists/empty`. */
const EMPTY = "empty";

const isIndex = (text: string): boolean => /^(0|[1-9][0-9]*)$/.test(text);

/** The node a media ID names, or null when it isn't one of Wave's. */
export const decodeAutoMediaId = (mediaId: string): AutoNode | null =>
  decodeListed(mediaId) ?? decodeEmpty(mediaId);

/** `<list>/empty`, for a list that has an empty item. */
const decodeEmpty = (mediaId: string): AutoNode | null => {
  const suffix = `/${EMPTY}`;
  if (!mediaId.endsWith(suffix)) return null;
  const parent = decodeListed(mediaId.slice(0, -suffix.length));
  return parent !== null && emptyTitles(parent) !== null ? { type: "empty", parent } : null;
};

/** Every node but an empty item. */
const decodeListed = (mediaId: string): AutoNode | null => {
  let parts: string[];
  try {
    parts = mediaId.split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  const [head = "", ...rest] = parts;
  if (head === ROOT_ID) return rest.length === 0 ? { type: "root" } : null;
  if (head === "tab") {
    const tab = AUTO_TABS.find((candidate) => candidate === rest[0]);
    return tab !== undefined && rest.length === 1 ? { type: "tab", tab } : null;
  }
  if (!isTrackListKind(head)) return null;
  const [id = "", what, index = "", trackId = "", ...more] = rest;
  if (id === "" || more.length > 0) return null;
  const list: AutoTrackList = { kind: head, id };
  if (rest.length === 1) return { type: "list", list };
  if (what === "shuffle" && rest.length === 2) return { type: "shuffle", list };
  if (what === "track" && rest.length === 4 && isIndex(index) && trackId !== "") {
    return { type: "track", list, index: Number(index), trackId };
  }
  return null;
};

/** One entry of a list in Auto. */
export interface AutoItem {
  readonly mediaId: string;
  readonly title: string;
  readonly subtitle: string | null;
  /** Opens a list of children. */
  readonly browsable: boolean;
  /** Starts playback. */
  readonly playable: boolean;
}

const folder = (node: AutoNode, title: string, subtitle: string | null = null): AutoItem => ({
  mediaId: encodeAutoMediaId(node),
  title,
  subtitle,
  browsable: true,
  playable: false,
});

const playable = (node: AutoNode, title: string, subtitle: string | null = null): AutoItem => ({
  mediaId: encodeAutoMediaId(node),
  title,
  subtitle,
  browsable: false,
  playable: true,
});

/** The browse root Auto asks for first; its children are the tabs. */
export const AUTO_ROOT: AutoItem = folder({ type: "root" }, "Wave");

/**
 * Library rows a node lists after its fixed items. The app fetches them and
 * turns them into items (`autoAlbumItem`, `autoTrackItems`…).
 */
export type AutoSource =
  /** Every album, in Library order. */
  | { readonly type: "albums" }
  /** Every playlist, by name (Library order); `autoPlaylistItem` builds each. */
  | { readonly type: "playlists" }
  /** A track list's tracks: the app loads all of them, `autoTrackItems` orders and pages them. */
  | { readonly type: "tracks"; readonly list: AutoTrackList };

/** The rows of `source` one page shows: `limit` of them from `offset`. */
export interface AutoFetch {
  readonly source: AutoSource;
  readonly offset: number;
  readonly limit: number;
}

/** One page of a node's children: its fixed items, then the rows to fetch, if any. */
export interface AutoChildren {
  readonly items: readonly AutoItem[];
  readonly fetch: AutoFetch | null;
}

/** What a browsable node lists: fixed items first, then the rows of a source. */
interface Listing {
  readonly items: readonly AutoItem[];
  readonly source: AutoSource | null;
}

const tabChildren = (tab: AutoTab): Listing => {
  switch (tab) {
    case "albums":
      return { items: [], source: { type: "albums" } };
    case "playlists":
      return { items: [], source: { type: "playlists" } };
    // Filled by their own tickets.
    case "home":
    case "artists":
      return { items: [], source: null };
  }
};

const tabItem = (tab: AutoTab): AutoItem => folder({ type: "tab", tab }, TAB_TITLES[tab]);

const shuffleItem = (list: AutoTrackList): AutoItem =>
  playable({ type: "shuffle", list }, "Shuffle");

const listing = (node: AutoNode): Listing | null => {
  switch (node.type) {
    case "root":
      return { items: AUTO_TABS.map(tabItem), source: null };
    case "tab":
      return tabChildren(node.tab);
    case "list":
      return { items: [shuffleItem(node.list)], source: { type: "tracks", list: node.list } };
    case "shuffle":
    case "track":
    case "empty":
      return null;
  }
};

/** What a node shows when it lists nothing (title, subtitle), or null: nothing at all. */
const emptyTitles = (node: AutoNode): readonly [string, string | null] | null =>
  node.type === "tab" && node.tab === "playlists"
    ? ["No playlists yet", "Create one in Wave on your phone"]
    : null;

const emptyItem = (parent: AutoNode): AutoItem | null => {
  const titles = emptyTitles(parent);
  if (titles === null) return null;
  return {
    mediaId: encodeAutoMediaId({ type: "empty", parent }),
    title: titles[0],
    subtitle: titles[1],
    browsable: false,
    playable: false,
  };
};

/**
 * What page `page` of `node` shows, given its items (fixed ones, then the
 * fetched rows): those items, or the node's empty item when its first page
 * has none.
 */
export const autoPageItems = (
  node: AutoNode,
  page: number,
  items: readonly AutoItem[],
): readonly AutoItem[] => {
  const empty = page === 0 && items.length === 0 ? emptyItem(node) : null;
  return empty === null ? items : [empty];
};

/**
 * The item for a node Auto asks about by media ID, when it doesn't depend on
 * the library; null for nodes the app builds from a row (`autoAlbumItem`,
 * `autoTrackItems`).
 */
export const autoItem = (node: AutoNode): AutoItem | null => {
  switch (node.type) {
    case "root":
      return AUTO_ROOT;
    case "tab":
      return tabItem(node.tab);
    case "shuffle":
      return shuffleItem(node.list);
    case "empty":
      return emptyItem(node.parent);
    case "list":
    case "track":
      return null;
  }
};

/** What an album row needs to show in Auto. */
export interface AutoAlbum {
  readonly id: number;
  readonly title: string;
  readonly albumArtist: string;
}

/** An album in a list (the Albums tab): opens its tracks. */
export const autoAlbumItem = (album: AutoAlbum): AutoItem =>
  folder(
    { type: "list", list: { kind: "album", id: String(album.id) } },
    album.title,
    album.albumArtist,
  );

/** What a playlist row needs to show in Auto. */
export interface AutoPlaylist {
  readonly id: number;
  readonly name: string;
  readonly trackCount: number;
}

const songCount = (count: number): string => `${count} ${count === 1 ? "song" : "songs"}`;

/** A playlist in a list (the Playlists tab): opens its tracks. */
export const autoPlaylistItem = (playlist: AutoPlaylist): AutoItem =>
  folder(
    { type: "list", list: { kind: "playlist", id: String(playlist.id) } },
    playlist.name,
    songCount(playlist.trackCount),
  );

/** Every track of `list` in its order (an album: by disc and track number). */
const ordered = (list: AutoTrackList, tracks: readonly AutoTrack[]): readonly AutoTrack[] =>
  TRACK_LISTS[list.kind].order(tracks);

/**
 * What playing a node starts, for the queue engine's `play` command: the
 * list's tracks in order, as `context`, from `startIndex` (undefined: anywhere,
 * with shuffle), and whether to shuffle (undefined keeps the current setting,
 * as tapping a song on the phone does).
 */
export interface AutoQueueStart {
  readonly context: QueueContext;
  readonly trackIds: readonly string[];
  readonly startIndex: number | undefined;
  readonly shuffle: boolean | undefined;
}

/** The track list a playable node plays (the app loads its tracks), or null. */
export const autoPlayList = (node: AutoNode): AutoTrackList | null =>
  node.type === "shuffle" || node.type === "track" ? node.list : null;

/**
 * What playing `node` starts, given every track of its list (`autoPlayList`)
 * in any order; null when there's nothing to play: a browsable node, an empty
 * list, or a track that has left the list.
 */
export const autoQueueStart = (
  node: AutoNode,
  tracks: readonly AutoTrack[],
): AutoQueueStart | null => {
  const list = autoPlayList(node);
  if (list === null) return null;
  const trackIds = ordered(list, tracks).map((track) => track.id);
  const context = TRACK_LISTS[list.kind].context(list.id);
  if (node.type === "track") {
    // The list may have changed since Auto showed it: find the track again.
    const startIndex =
      trackIds[node.index] === node.trackId ? node.index : trackIds.indexOf(node.trackId);
    return startIndex === -1 ? null : { context, trackIds, startIndex, shuffle: undefined };
  }
  return trackIds.length === 0 ? null : { context, trackIds, startIndex: undefined, shuffle: true };
};

/**
 * `limit` of a track list's tracks from `offset`, in list order: `tracks` is
 * the whole list, in any order. Each plays the list from itself.
 */
export const autoTrackItems = (
  list: AutoTrackList,
  tracks: readonly AutoTrack[],
  offset: number,
  limit: number,
): readonly AutoItem[] =>
  ordered(list, tracks)
    .slice(offset, offset + limit)
    .map((track, i) =>
      playable(
        { type: "track", list, index: offset + i, trackId: track.id },
        track.title,
        track.artist,
      ),
    );

/**
 * Page `page` (of `pageSize` children) of a browsable node, or null when the
 * node has no children (it plays instead). The node's fixed items come first,
 * so the first page of a track list starts with Shuffle and holds one track less.
 */
export const autoChildren = (
  node: AutoNode,
  page: number,
  pageSize: number,
): AutoChildren | null => {
  const children = listing(node);
  if (children === null) return null;
  const size = Math.max(0, pageSize);
  const start = Math.max(0, page) * size;
  const end = start + size;
  const fixed = children.items.length;
  const from = Math.max(start, fixed);
  const limit = Math.max(0, end - from);
  return {
    items: children.items.slice(Math.min(start, fixed), Math.min(end, fixed)),
    fetch:
      children.source === null || limit === 0
        ? null
        : { source: children.source, offset: from - fixed, limit },
  };
};
