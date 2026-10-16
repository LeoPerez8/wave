import {
  commonKind,
  counted,
  discoverTrackId,
  groupSongs,
  type ActionItem,
  type ItemKind,
  type MixedSong,
  type PlaylistPlace,
  type PlaylistSong,
  ytSongCredit,
} from "@wave/core";

import type { ArtistImageSource } from "@/catalog/ArtistImage";
import type { LibrarySection } from "@/catalog/sections";
import type { LibraryCounts } from "@/library/db/counts";
import type { NativeYtSong } from "@/native/waveYtMusic";
import type { AlbumRow, ArtistRow, GenreRow, PlaylistRow, SongRow } from "@/library/LibraryStore";
import { itemSongs, librarySectionSongs, playlistEntries } from "@/library/sectionSongs";

/**
 * What Wave's item actions (`itemActions.ts`) act on: library items of one
 * kind, and what each kind knows about its items (their songs, a menu's
 * heading, the facts Core's `itemActions` decides the entries from).
 */

/** A track's place in the playlist its menu was opened from. */
export type { PlaylistPlace };

/** A track as the actions see it: the song, and its place when shown in a playlist. */
export interface LibraryTrackItem {
  readonly song: SongRow;
  /** Set in a playlist: offers Remove from Playlist. */
  readonly playlistItem?: PlaylistPlace | undefined;
}

/** A checked song, either the Library's track or a YT Music song. */
export type TrackItem = LibraryTrackItem | {
  readonly ytSong: NativeYtSong;
  readonly playlistItem?: PlaylistPlace | undefined;
};

export const isLibraryTrack = (item: TrackItem): item is LibraryTrackItem => "song" in item;

/** A song as the selection actions take it. */
export const listedTrackItem = (entry: MixedSong<NativeYtSong, SongRow>): TrackItem =>
  entry.source === "library" ? { song: entry.track } : { ytSong: entry.song };

export const trackItemKey = (item: TrackItem): string =>
  isLibraryTrack(item) ? String(item.song.id) : `yt:${item.ytSong.videoId}`;

export const tracksTarget = (items: readonly TrackItem[]): ActionItems => ({ kind: "track", items });

/** An item of a page that shows several kinds together (an artist's albums and songs). */
export type MixedItem =
  | { readonly kind: "track"; readonly item: TrackItem }
  | { readonly kind: "album"; readonly item: AlbumRow };

/** The item type of each kind. */
export interface ItemOf {
  readonly track: TrackItem;
  readonly album: AlbumRow;
  readonly artist: ArtistRow;
  readonly playlist: PlaylistRow;
  readonly genre: GenreRow;
  readonly section: LibrarySection;
  readonly mixed: MixedItem;
}

/** What actions act on: items of one kind, in the order shown (one, for a menu). */
export type ActionItems = {
  readonly [K in ItemKind]: { readonly kind: K; readonly items: readonly ItemOf[K][] };
}[ItemKind];

export interface Heading {
  readonly title: string;
  readonly subtitle: string;
  /** Artwork beside the title; undefined for a text-only heading. */
  readonly covers: readonly string[] | undefined;
  /** An artist's heading shows their image (a circle) instead of covers. */
  readonly artist?: ArtistImageSource;
}

/** What the actions need to know about one kind of item. */
interface KindInfo<T> {
  /** An item's songs, in the order its own screen plays them. */
  readonly songs: (item: T) => Promise<readonly SongRow[]>;
  /** What a menu says it's about; `sectionSongs` counts each Library entry's songs, once known. */
  readonly heading: (item: T, sectionSongs: LibraryCounts | undefined) => Heading;
  /** What Core's `itemActions` needs to know about it. */
  readonly facts: (item: T, favorites: ReadonlySet<number>) => ActionItem;
  /** What a count of them is called ("12 songs"). */
  readonly noun: string;
}

const cover = (thumbPath: string | null): readonly string[] =>
  thumbPath === null ? [] : [thumbPath];

const NO_FACTS: ActionItem = {};

const KIND_TRACK: KindInfo<TrackItem> = {
  songs: (item) => Promise.resolve(isLibraryTrack(item) ? [item.song] : []),
  heading: (item) => isLibraryTrack(item)
    ? { title: item.song.title, subtitle: item.song.artist, covers: cover(item.song.thumbPath) }
    : { title: item.ytSong.title, subtitle: ytSongCredit(item.ytSong), covers: [] },
  facts: (item, favorites) => isLibraryTrack(item)
    ? {
        albumId: item.song.albumId,
        artistIds: item.song.artistIds,
        favorite: favorites.has(item.song.id),
        inPlaylist: item.playlistItem !== undefined,
        missing: item.song.path === null,
      }
    : { streamed: true, artistNames: item.ytSong.artists ?? [], inPlaylist: item.playlistItem !== undefined },
  noun: "song",
};

const KIND_ALBUM: KindInfo<AlbumRow> = {
  songs: (album) => itemSongs("albums", album.id),
  heading: (album) => ({
    title: album.title,
    subtitle: album.albumArtist,
    covers: cover(album.thumbPath),
  }),
  facts: (album) => ({ artistIds: album.albumArtistIds }),
  noun: "album",
};

/** Runs [run] with a mixed item's own kind and the item, typed for each other. */
const asOwnKind = <R>(mixed: MixedItem, run: <T>(kind: KindInfo<T>, item: T) => R): R =>
  mixed.kind === "track" ? run(KIND_TRACK, mixed.item) : run(KIND_ALBUM, mixed.item);

const KINDS: { readonly [K in ItemKind]: KindInfo<ItemOf[K]> } = {
  track: KIND_TRACK,
  album: KIND_ALBUM,
  artist: {
    songs: (artist) => itemSongs("artists", artist.id),
    heading: (artist) => ({
      title: artist.name,
      subtitle: counted(artist.trackCount, "song"),
      covers: undefined,
      artist,
    }),
    facts: () => NO_FACTS,
    noun: "artist",
  },
  // Genres have no picture; their headings are text only.
  playlist: {
    songs: (playlist) => itemSongs("playlists", playlist.id),
    heading: (playlist) => ({
      title: playlist.name,
      subtitle: counted(playlist.trackCount, "song"),
      covers: playlist.thumbPaths,
    }),
    facts: () => NO_FACTS,
    noun: "playlist",
  },
  genre: {
    songs: (genre) => itemSongs("genres", genre.id),
    heading: (genre) => ({
      title: genre.name,
      subtitle: counted(genre.trackCount, "song"),
      covers: undefined,
    }),
    facts: () => NO_FACTS,
    noun: "genre",
  },
  section: {
    songs: (section) => librarySectionSongs(section.slug),
    heading: (section, sectionSongs) => {
      const count = sectionSongs?.[section.slug];
      return {
        title: section.label,
        subtitle: count === undefined ? "" : counted(count, "song"),
        covers: undefined,
      };
    },
    facts: () => NO_FACTS,
    noun: "section",
  },
  // Albums and songs checked together: each acts as its own kind would.
  mixed: {
    songs: (mixed) => asOwnKind(mixed, (kind, item) => kind.songs(item)),
    heading: (mixed, sectionSongs) =>
      asOwnKind(mixed, (kind, item) => kind.heading(item, sectionSongs)),
    // An album counts as its own album, so songs checked with it share it (Go to Album).
    facts: (mixed, favorites) =>
      mixed.kind === "track"
        ? KIND_TRACK.facts(mixed.item, favorites)
        : { albumId: mixed.item.id, artistIds: mixed.item.albumArtistIds },
    noun: "item",
  },
};

/** [target]'s items, without their kind's item type. */
type UntypedItems = { readonly kind: ItemKind; readonly items: readonly unknown[] };

/**
 * The info of [target]'s kind, over items of any type: TypeScript can't
 * correlate `KINDS[target.kind]` with `target.items` on its own, and every
 * caller passes the target's own items.
 */
const kindInfo = (target: ActionItems): KindInfo<unknown> =>
  KINDS[target.kind] as unknown as KindInfo<unknown>;

const itemsOf = (target: ActionItems): readonly unknown[] => (target as UntypedItems).items;

const songId = (song: SongRow): number => song.id;

/**
 * The songs the queue actions act on: each item's, in the items' order. Groups
 * (albums, artists…) expand by Core's `groupSongs`: a song two of them hold
 * comes once; checked tracks are taken as they are.
 */
export const targetSongs = async (target: ActionItems): Promise<readonly SongRow[]> => {
  const kind = kindInfo(target);
  const lists = await Promise.all(itemsOf(target).map((item) => kind.songs(item)));
  return target.kind === "track" ? lists.flat() : groupSongs(lists, songId);
};

/** A song an action acts on: a Library song, or a playlist's YT Music entry, streamed. */
export type TargetEntry = MixedSong<NativeYtSong, SongRow>;

/**
 * What the queue and playlist actions act on, with playlists' YT Music
 * entries in their places: each playlist's entries in playlist order (an
 * entry two of them hold comes once), any other target's songs as
 * `targetSongs` gives them.
 */
export const targetEntries = async (target: ActionItems): Promise<readonly TargetEntry[]> => {
  if (target.kind === "track")
    return target.items.map((item) => isLibraryTrack(item)
      ? { source: "library", track: item.song }
      : { source: "stream", song: item.ytSong });
  if (target.kind === "mixed") {
    const lists = await Promise.all(target.items.map((item) => targetEntries(
      item.kind === "track" ? { kind: "track", items: [item.item] } : { kind: "album", items: [item.item] },
    )));
    return groupSongs(lists, discoverTrackId);
  }
  if (target.kind !== "playlist")
    return (await targetSongs(target)).map((track) => ({ source: "library", track }));
  const lists = await Promise.all(target.items.map((playlist) => playlistEntries(playlist.id)));
  return groupSongs(
    lists.map((entries) =>
      entries.map((entry): TargetEntry =>
        entry.source === "library"
          ? { source: "library", track: entry.track }
          : { source: "stream", song: entry.song },
      ),
    ),
    discoverTrackId,
  );
};

/** [entries] as songs a playlist takes (Core's `PlaylistSong`). */
export const toPlaylistSongs = (entries: readonly TargetEntry[]): PlaylistSong[] =>
  entries.map((entry) =>
    entry.source === "library"
      ? { source: "library", trackId: entry.track.id }
      : { source: "stream", song: entry.song },
  );

/** What Core's `itemActions` needs to know about each of [target]'s items. */
export const targetFacts = (
  target: ActionItems,
  favorites: ReadonlySet<number>,
): readonly ActionItem[] => {
  const kind = kindInfo(target);
  return itemsOf(target).map((item) => kind.facts(item, favorites));
};

/**
 * What the actions act on when albums and songs are checked together, in page
 * order: all songs act as songs (Favorite, Delete), all albums as albums, and
 * a mix as `mixed` (the entries both share).
 */
export const mixedTarget = (items: readonly MixedItem[]): ActionItems => {
  const kind = commonKind(items.map((item) => item.kind));
  if (kind === "track")
    return { kind, items: items.flatMap((item) => (item.kind === "track" ? [item.item] : [])) };
  if (kind === "album")
    return { kind, items: items.flatMap((item) => (item.kind === "album" ? [item.item] : [])) };
  return { kind: "mixed", items };
};

/** A menu's heading: what its one item is. */
export const targetHeading = (
  target: ActionItems,
  sectionSongs: LibraryCounts | undefined,
): Heading | undefined => {
  const first = itemsOf(target)[0];
  return first === undefined ? undefined : kindInfo(target).heading(first, sectionSongs);
};

/** "12 songs", "3 albums": what a count of the target's items is called. */
export const targetCount = (target: ActionItems): string =>
  counted(target.items.length, kindInfo(target).noun);
