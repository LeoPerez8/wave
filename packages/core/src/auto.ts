import { en, type Catalogue } from "./catalogueEn.ts";
/**
 * Wave's browse tree in Android Auto: which nodes exist, how their media IDs
 * read, what each node's children are (page by page) and what playing a node
 * starts. The app fetches the library rows a node lists and hands the start to
 * the queue engine, so the car and the phone share one set of playback rules.
 *
 * Extending the tree:
 * - a tab: add it to `AUTO_TABS` and the Auto catalogue, and describe its children in
 *   `tabChildren` (fixed items and/or an `AutoSource`);
 * - a track list (something with a Shuffle item and tracks that play it as
 *   their context): add its kind to `AutoTrackListKind` and `TRACK_LISTS`
 *   (`ids` when the kind has a fixed set of ids);
 * - another browsable node (say, an artist): add an `AutoNode` variant, its
 *   segments in `encodeAutoMediaId`/`decodeAutoMediaId`, its children in
 *   `listing` and, if it plays, its list in `autoPlayList`;
 * - artwork on an item built from a row: pass the row's covers as the last
 *   argument of `folder`/`playable` (a cover, or `playlistMosaic`'s four);
 * - an explicit item for a list with nothing in it: its titles in `emptyTitles`.
 *
 * The app side (`apps/mobile/src/auto/Auto.ts`) loads a source's rows in
 * `fetch` and a track list's songs in `listSongs`.
 */

import { playlistPlayback, queueSongTrackId, type QueueSong } from "./playlistEntries.ts";
import type { QueueContext } from "./queue.ts";
import { sizedCoverUrls } from "./streamedCover.ts";
import type { YtSong } from "./ytMusic.ts";

/** Auto's tabs: the root's children, in order. */
export type AutoTab = "home" | "playlists" | "albums" | "artists";

export const AUTO_TABS: readonly AutoTab[] = ["home", "playlists", "albums", "artists"];

/**
 * A track as a track list needs it: shown in Auto and played. A list's tracks
 * come in the order the app lists them (an album by disc and track number, a
 * playlist in playlist order, an artist's songs by title, Home's sections in
 * Home's order), so Auto and the phone show and play them alike.
 */
export interface AutoTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  /** The track's cached artwork file, if it has one. */
  readonly artworkPath?: string | null;
}

/** Home's song sections: track lists of kind `home`, with the context ids the app uses. */
export type AutoHomeList = "most-played" | "favorites";

const AUTO_HOME_LISTS: readonly AutoHomeList[] = ["most-played", "favorites"];

/** The kinds of track list Auto can open or play. */
export type AutoTrackListKind =
  | "album"
  | "playlist"
  /** Every song by an artist or on their albums (the artist's Shuffle all). */
  | "artistSongs"
  /** Home's song sections (`AutoHomeList`). */
  | "home";

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
  /** The only ids the kind has, when it has a fixed set (Home's sections). */
  readonly ids?: readonly string[];
  /** The title of its Shuffle item, when not "Shuffle". */
}

/** One entry per track list kind; the media ID segment is the kind itself. */
const TRACK_LISTS: Record<AutoTrackListKind, TrackListKind> = {
  album: { context: (id) => ({ kind: "album", id }) },
  playlist: { context: (id) => ({ kind: "playlist", id }) },
  // Home's song sections.
  home: { context: (id) => ({ kind: "home", id }), ids: AUTO_HOME_LISTS },
  // Not `artist`: that segment names the browsable artist.
  artistSongs: { context: (id) => ({ kind: "artist", id }) },
};

const isTrackListKind = (kind: string): kind is AutoTrackListKind =>
  Object.prototype.hasOwnProperty.call(TRACK_LISTS, kind);

/** A node of the browse tree, as its media ID says. */
export type AutoNode =
  | { readonly type: "root" }
  | { readonly type: "tab"; readonly tab: AutoTab }
  /** Home's Recently Played albums. */
  | { readonly type: "recentlyPlayed" }
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
  | { readonly type: "empty"; readonly parent: AutoNode }
  /** An artist to open: Shuffle all, then their albums. `id` is the artist id. */
  | { readonly type: "artist"; readonly id: string };

const ROOT_ID = "root";
/** Recently Played's media ID is `home/recently-played`, beside Home's track lists. */
const HOME = "home";
const RECENTLY_PLAYED = "recently-played";

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
      case "recentlyPlayed":
        return [HOME, RECENTLY_PLAYED];
      case "list":
        return [node.list.kind, node.list.id];
      case "shuffle":
        return [node.list.kind, node.list.id, "shuffle"];
      case "track":
        return [node.list.kind, node.list.id, "track", String(node.index), node.trackId];
      case "artist":
        return ["artist", node.id];
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
  if (head === HOME && rest[0] === RECENTLY_PLAYED) {
    return rest.length === 1 ? { type: "recentlyPlayed" } : null;
  }
  if (head === "artist") {
    return rest.length === 1 && rest[0] !== "" ? { type: "artist", id: rest[0] ?? "" } : null;
  }
  if (!isTrackListKind(head)) return null;
  const [id = "", what, index = "", trackId = "", ...more] = rest;
  if (id === "" || more.length > 0) return null;
  const ids = TRACK_LISTS[head].ids;
  if (ids !== undefined && !ids.includes(id)) return null;
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
  /**
   * Covers to show: one, or four for a mosaic (Core's `playlistMosaic`).
   * Absent without artwork, so Auto shows its placeholder.
   */
  readonly artwork?: AutoArtwork;
}

/**
 * One cover: a cached artwork file (its path as the library stores it), or an
 * online cover's addresses, best first (Core's `sizedCoverUrls`).
 */
export type AutoCover = string | readonly string[];

/** An item's covers: one, or four for a 2×2 mosaic. */
export type AutoArtwork = readonly AutoCover[];

/**
 * The artwork part of an item: the known covers among [covers] (missing ones
 * are skipped), or nothing at all when none is known. Every item builder
 * passes its row's artwork here.
 */
const artworkOf = (
  covers: readonly (AutoCover | null | undefined)[],
): { artwork?: AutoArtwork } => {
  const known = covers.filter(
    (cover): cover is AutoCover => cover !== null && cover !== undefined && cover !== "",
  );
  return known.length === 0 ? {} : { artwork: known };
};

const folder = (
  node: AutoNode,
  title: string,
  subtitle: string | null = null,
  artwork: readonly (AutoCover | null | undefined)[] = [],
): AutoItem => ({
  mediaId: encodeAutoMediaId(node),
  title,
  subtitle,
  browsable: true,
  playable: false,
  ...artworkOf(artwork),
});

const playable = (
  node: AutoNode,
  title: string,
  subtitle: string | null = null,
  artwork: readonly (AutoCover | null | undefined)[] = [],
): AutoItem => ({
  mediaId: encodeAutoMediaId(node),
  title,
  subtitle,
  browsable: false,
  playable: true,
  ...artworkOf(artwork),
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
  /** Every playlist, in the phone's Playlists order; `autoPlaylistItem` builds each. */
  | { readonly type: "playlists" }
  /** Every artist with songs, in Library order (leading articles and accents ignored). */
  | { readonly type: "artists" }
  /** The albums an artist's screen shows: theirs, then the ones they appear on. */
  | { readonly type: "artistAlbums"; readonly id: string }
  /** A track list's tracks, in list order (see `AutoTrack`); `autoTrackItems` builds each. */
  | { readonly type: "tracks"; readonly list: AutoTrackList }
  /** The albums of Home's Recently Played, as the app's Home tab lists them. */
  | { readonly type: "recentlyPlayed" };

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

const recentlyPlayedItem = (c: Catalogue) =>
  folder({ type: "recentlyPlayed" }, c.auto.recentlyPlayed);
/** The Home song section `list` is, or undefined for any other list. */
const homeList = (list: AutoTrackList): AutoHomeList | undefined =>
  list.kind === "home" ? AUTO_HOME_LISTS.find((known) => known === list.id) : undefined;

/** The folder of one of Home's song sections, or null for any other list. */
const homeListItem = (list: AutoTrackList, c: Catalogue): AutoItem | null => {
  const id = homeList(list);
  return id === undefined
    ? null
    : folder({ type: "list", list }, id === "most-played" ? c.auto.mostPlayed : c.auto.favorites);
};

const tabChildren = (tab: AutoTab, c: Catalogue): Listing => {
  switch (tab) {
    case "albums":
      return { items: [], source: { type: "albums" } };
    case "playlists":
      return { items: [], source: { type: "playlists" } };
    case "home":
      return {
        items: [
          recentlyPlayedItem(c),
          ...AUTO_HOME_LISTS.flatMap((id) => homeListItem({ kind: "home", id }, c) ?? []),
        ],
        source: null,
      };
    case "artists":
      return { items: [], source: { type: "artists" } };
  }
};

const tabItem = (tab: AutoTab, c: Catalogue): AutoItem => folder({ type: "tab", tab }, c.auto[tab]);

const shuffleItem = (list: AutoTrackList, c: Catalogue): AutoItem =>
  playable(
    { type: "shuffle", list },
    list.kind === "artistSongs" ? c.auto.shuffleAll : c.auto.shuffle,
  );

const listing = (node: AutoNode, c: Catalogue = en): Listing | null => {
  switch (node.type) {
    case "root":
      return { items: AUTO_TABS.map((tab) => tabItem(tab, c)), source: null };
    case "tab":
      return tabChildren(node.tab, c);
    case "recentlyPlayed":
      return { items: [], source: { type: "recentlyPlayed" } };
    case "list":
      return { items: [shuffleItem(node.list, c)], source: { type: "tracks", list: node.list } };
    case "shuffle":
    case "track":
    case "empty":
      return null;
    case "artist":
      return {
        items: [shuffleItem({ kind: "artistSongs", id: node.id }, c)],
        source: { type: "artistAlbums", id: node.id },
      };
  }
};

/** What a node shows when it lists nothing (title, subtitle), or null: nothing at all. */
const emptyTitles = (
  node: AutoNode,
  c: Catalogue = en,
): readonly [string, string | null] | null => {
  if (node.type === "tab" && node.tab === "playlists") {
    return [c.auto.noPlaylists, c.auto.createPlaylist];
  }
  if (node.type === "recentlyPlayed") {
    return [c.auto.nothingPlayed, c.auto.albumsPlayed];
  }
  if (node.type === "list") {
    switch (homeList(node.list)) {
      case "most-played":
        return [c.auto.noPlays, c.auto.songsPlayed];
      case "favorites":
        return [c.auto.noFavorites, c.auto.songsStarred];
      case undefined:
        return null;
    }
  }
  return null;
};

const emptyItem = (parent: AutoNode, c: Catalogue): AutoItem | null => {
  const titles = emptyTitles(parent, c);
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
 * has no rows (a Shuffle with nothing to shuffle goes with them).
 */
export const autoPageItems = (
  node: AutoNode,
  page: number,
  items: readonly AutoItem[],
  c: Catalogue = en,
): readonly AutoItem[] => {
  const fixed = listing(node, c)?.items.length ?? 0;
  const empty = page === 0 && items.length <= fixed ? emptyItem(node, c) : null;
  return empty === null ? items : [empty];
};

/**
 * The item for a node Auto asks about by media ID, when it doesn't depend on
 * the library (Home's sections among them); null for nodes the app builds
 * from a row (`autoAlbumItem`, `autoTrackItems`).
 */
export const autoItem = (node: AutoNode, c: Catalogue = en): AutoItem | null => {
  switch (node.type) {
    case "root":
      return AUTO_ROOT;
    case "tab":
      return tabItem(node.tab, c);
    case "shuffle":
      return shuffleItem(node.list, c);
    case "empty":
      return emptyItem(node.parent, c);
    case "recentlyPlayed":
      return recentlyPlayedItem(c);
    case "list":
      return homeListItem(node.list, c);
    case "track":
    case "artist":
      return null;
  }
};

/** What an album row needs to show in Auto. */
export interface AutoAlbum {
  readonly id: number;
  readonly title: string;
  readonly albumArtist: string;
  /** The album's cached cover file, if it has one. */
  readonly artworkPath?: string | null;
}

/** An album in a list (the Albums tab): opens its tracks. */
export const autoAlbumItem = (album: AutoAlbum): AutoItem =>
  folder(
    { type: "list", list: { kind: "album", id: String(album.id) } },
    album.title,
    album.albumArtist,
    [album.artworkPath],
  );

/** What a playlist row needs to show in Auto. */
export interface AutoPlaylist {
  readonly id: number;
  readonly name: string;
  readonly trackCount: number;
  /** Its mosaic's files (Core's `playlistMosaic`): none, one or four. */
  readonly thumbPaths?: readonly string[];
}

/**
 * The side, in physical pixels, a playlist's online cover is asked for at.
 * The car's host doesn't say what it draws, so it's the size Library covers
 * reach Auto's tiles at (the medium cover). A mosaic's tile takes half.
 */
const AUTO_COVER_SIDE = 640;

/**
 * [paths] as Auto's covers: files as they are, online addresses at the size
 * Auto draws them, or dropped with YT Music off, when Wave asks the web for no
 * cover (docs/spec.md).
 */
const autoPlaylistCovers = (paths: readonly string[], ytMusic: boolean): AutoArtwork => {
  const side = paths.length > 1 ? AUTO_COVER_SIDE / 2 : AUTO_COVER_SIDE;
  return paths.flatMap((path): AutoCover[] => {
    if (!/^https?:\/\//.test(path)) return [path];
    return ytMusic ? [sizedCoverUrls(path, side)] : [];
  });
};

/** A playlist in a list (the Playlists tab): opens its tracks. [ytMusic] is the YT Music switch. */
export const autoPlaylistItem = (
  playlist: AutoPlaylist,
  c: Catalogue = en,
  ytMusic = false,
): AutoItem =>
  folder(
    { type: "list", list: { kind: "playlist", id: String(playlist.id) } },
    playlist.name,
    c.auto.songs(playlist.trackCount),
    autoPlaylistCovers(playlist.thumbPaths ?? [], ytMusic),
  );

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
 * in list order; null when there's nothing to play: a browsable node, an
 * empty list, or a track that has left the list.
 */
export const autoQueueStart = (
  node: AutoNode,
  tracks: readonly Pick<AutoTrack, "id">[],
): AutoQueueStart | null => {
  const list = autoPlayList(node);
  if (list === null) return null;
  const trackIds = tracks.map((track) => track.id);
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
 * What adding `node` to the queue adds (a controller asked to add it rather
 * than play it), given every track of its list (`autoPlayList`) in list order:
 * a track adds itself; Shuffle adds its whole list, in list order. Null when
 * there's nothing to add: a browsable node, an empty list, or a track that
 * has left the list.
 */
export const autoQueueAdd = (
  node: AutoNode,
  tracks: readonly AutoTrack[],
): readonly string[] | null => {
  const start = autoQueueStart(node, tracks);
  if (start === null) return null;
  const { trackIds, startIndex } = start;
  return node.type === "track" && startIndex !== undefined
    ? trackIds.slice(startIndex, startIndex + 1)
    : trackIds;
};

/**
 * What playing or adding a node of a track list does once the app has the
 * list's songs: the queue start, the track ids an add adds, and the songs
 * that play (for the queue's track data); or why nothing plays.
 */
export type AutoListPlay<S extends YtSong, L> =
  | {
      readonly kind: "play";
      readonly start: AutoQueueStart;
      readonly added: readonly string[];
      readonly songs: readonly QueueSong<S, L>[];
    }
  /** A browsable node, an empty list, or a song that has left the list. */
  | { readonly kind: "notFound" }
  /** YT Music is off, and the node is one of its entries or the list has nothing else. */
  | { readonly kind: "ytMusicOff" };

/**
 * What playing or adding [node] does, given every song of its list
 * (`autoPlayList`) in list order: the phone's rule for a playlist with YT
 * Music entries (`playlistPlayback`; with YT Music off they show but don't
 * play), then Auto's (`autoQueueStart`, `autoQueueAdd`).
 */
export const autoListPlay = <S extends YtSong, L extends { readonly id: number }>(
  node: AutoNode,
  songs: readonly QueueSong<S, L>[],
  ytMusic: boolean,
): AutoListPlay<S, L> => {
  const listed = autoQueueStart(
    node,
    songs.map((song) => ({ id: queueSongTrackId(song) })),
  );
  if (listed === null) return { kind: "notFound" };
  const play = playlistPlayback(songs, { ytMusic, startIndex: listed.startIndex });
  if (play === null) return { kind: "ytMusicOff" };
  const played: readonly QueueSong<S, L>[] =
    play.playback.kind === "mixed"
      ? play.playback.songs
      : play.playback.tracks.map((track) => ({ source: "library", track }));
  const trackIds = played.map(queueSongTrackId);
  const { startIndex } = play;
  return {
    kind: "play",
    start: { ...listed, trackIds, startIndex },
    added:
      node.type === "track" && startIndex !== undefined
        ? trackIds.slice(startIndex, startIndex + 1)
        : trackIds,
    songs: played,
  };
};

/**
 * The items of a page of a track list: `tracks` are the list's tracks from
 * `offset` on, in list order (the rows an `AutoFetch` asks for). Each plays
 * the list from itself.
 */
export const autoTrackItems = (
  list: AutoTrackList,
  tracks: readonly AutoTrack[],
  offset: number,
): readonly AutoItem[] =>
  tracks.map((track, i) =>
    playable(
      { type: "track", list, index: offset + i, trackId: track.id },
      track.title,
      track.artist,
      [track.artworkPath],
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
  c: Catalogue = en,
): AutoChildren | null => {
  const children = listing(node, c);
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

/** What an artist row needs to show in Auto. */
export interface AutoArtist {
  readonly id: number;
  readonly name: string;
  /** A cover of theirs (the store's `artistCovers`), if they have one. */
  readonly artworkPath?: string | null;
}

/** An artist in a list (the Artists tab): opens Shuffle all and their albums. */
export const autoArtistItem = (artist: AutoArtist): AutoItem =>
  folder({ type: "artist", id: String(artist.id) }, artist.name, null, [artist.artworkPath]);
