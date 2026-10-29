import {
  canFixSong,
  groupSongs,
  joinArtists,
  queueSongTrackId,
  type ActionItem,
  type ItemKind,
  type MixedSong,
  type PlaylistPlace,
  type PlaylistSong,
  type QueueSong,
  type UnsearchedSong,
  ytAlbumSongs,
  ytSongCredit,
  ytSongStarred,
} from "@wave/core";

import * as Result from "effect/Result";

import type { ArtistImageSource } from "@/catalog/ArtistImage";
import { currentLocalisation } from "@/localisation/localisation";
import type { LibrarySection } from "@/catalog/sections";
import type { LibraryCounts } from "@/library/db/counts";
import type { NativeYtSong } from "@/native/waveYtMusic";
import type { AlbumRow, ArtistRow, GenreRow, PlaylistRow, SongRow } from "@/library/LibraryStore";
import { itemSongs, librarySectionSongs, playlistEntries } from "@/library/sectionSongs";
import { currentLibraryFinder, type FindInLibrary } from "@/ytmusic/libraryFinder";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { resolveMixedEntries } from "./mixedEntries";
import { trackEntry, type MixedItem } from "./mixedItems";

export { mixedTarget, trackItemKey, type MixedItem } from "./mixedItems";

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

/** A YT Music song as the actions see it, streamed: checked beside the Library's songs. */
export interface YtTrackItem {
  readonly ytSong: NativeYtSong;
  /** Set in a playlist: offers Remove from Playlist. */
  readonly playlistItem?: PlaylistPlace | undefined;
}

/**
 * A playlist's unsearched entry as the actions see it: what Spotify listed,
 * not searched yet. It acts as a YT Music entry does, searched as it's about
 * to play.
 */
export interface UnsearchedTrackItem {
  readonly unsearched: UnsearchedSong;
  /** Set in a playlist: offers Remove from Playlist. */
  readonly playlistItem?: PlaylistPlace | undefined;
}

/** A song the actions act on: the Library's, a YT Music song, or an unsearched one. */
export type TrackItem = LibraryTrackItem | YtTrackItem | UnsearchedTrackItem;

export const isLibraryTrack = (item: TrackItem): item is LibraryTrackItem => "song" in item;

export const isUnsearchedTrack = (item: TrackItem): item is UnsearchedTrackItem =>
  "unsearched" in item;

/** A listed song (a Library track, or YT Music's, streamed) as the actions take it. */
export const listedTrackItem = (entry: MixedSong<NativeYtSong, SongRow>): TrackItem =>
  entry.source === "library" ? { song: entry.track } : { ytSong: entry.song };

/** The checked songs, as the selection bar acts on them. */
export const tracksTarget = (items: readonly TrackItem[]): ActionItems => ({
  kind: "track",
  items,
});

/** [target]'s songs, each as the Library's or YT Music's. */
const targetTracks = (target: ActionItems): readonly TrackItem[] =>
  target.kind === "track"
    ? target.items
    : target.kind === "mixed"
      ? target.items.flatMap((item) => (item.kind === "track" ? [item.item] : []))
      : [];

/** Whether any of [target]'s songs is a YT Music song. */
export const hasStreamedSongs = (target: ActionItems): boolean =>
  targetTracks(target).some((item) => !isLibraryTrack(item));

/** Only the streamed credits an explicit menu/selection/swipe needs to resolve. */
export const targetStreamedArtistNames = (target: ActionItems): readonly string[] =>
  targetTracks(target).flatMap((item) =>
    isLibraryTrack(item)
      ? []
      : isUnsearchedTrack(item)
        ? item.unsearched.artists
        : (item.ytSong.artists ?? []),
  );

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
}[ItemKind] & {
  /** Plan from displayed metadata; acquire songs and Library matches only after an action. */
  readonly readOnAction?: true;
};

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
  /**
   * What Core's `itemActions` needs to know about it; [find] tells whether a
   * YT Music song is the Library's file by now, and [pending] which YT Music
   * songs are starred, waiting for their files (pending favorites, by video).
   */
  readonly facts: (
    item: T,
    favorites: ReadonlySet<number>,
    find: FindInLibrary,
    pending: ReadonlySet<string>,
  ) => ActionItem;
  /** A count of them in the app's language ("12 songs"). */
  readonly count: (count: number) => string;
}

const library = () => currentLocalisation().strings.library;
const songCount = (count: number): string => library().songCount(count);

const cover = (thumbPath: string | null): readonly string[] =>
  thumbPath === null ? [] : [thumbPath];

const NO_FACTS: ActionItem = {};

/**
 * A YT Music song's facts: starred as the Library's song ([track]) once the
 * Library has it, else as a pending favorite ([pending]).
 */
const ytFacts = (
  item: YtTrackItem,
  favorites: ReadonlySet<number>,
  track: SongRow | null,
  pending: ReadonlySet<string>,
): ActionItem => ({
  streamed: true,
  artistNames: item.ytSong.artists ?? [],
  inPlaylist: item.playlistItem !== undefined,
  downloaded: track?.path != null,
  favorite: ytSongStarred(item.ytSong.videoId, track, favorites, pending),
});

const KIND_TRACK: KindInfo<TrackItem> = {
  // A YT Music song has no Library songs: the queue and playlist actions take it as it is (`targetEntries`).
  songs: (item) => Promise.resolve(isLibraryTrack(item) ? [item.song] : []),
  heading: (item) =>
    isLibraryTrack(item)
      ? { title: item.song.title, subtitle: item.song.artist, covers: cover(item.song.thumbPath) }
      : isUnsearchedTrack(item)
        ? {
            title: item.unsearched.title,
            subtitle: joinArtists(item.unsearched.artists),
            covers: [],
          }
        : { title: item.ytSong.title, subtitle: ytSongCredit(item.ytSong), covers: [] },
  facts: (item, favorites, find, pending) =>
    isLibraryTrack(item)
      ? {
          albumId: item.song.albumId,
          artistIds: item.song.artistIds,
          favorite: favorites.has(item.song.id),
          inPlaylist: item.playlistItem !== undefined,
          missing: item.song.path === null,
          fixable: canFixSong(item.song),
        }
      : isUnsearchedTrack(item)
        ? {
            streamed: true,
            unsearched: true,
            artistNames: item.unsearched.artists,
            inPlaylist: item.playlistItem !== undefined,
          }
        : ytFacts(item, favorites, find(item.ytSong), pending),
  count: songCount,
};

const KIND_ALBUM: KindInfo<AlbumRow> = {
  songs: (album) => itemSongs("albums", album.id),
  heading: (album) => ({
    title: album.title,
    subtitle: album.albumArtist,
    covers: cover(album.thumbPath),
  }),
  facts: (album) => ({ artistIds: album.albumArtistIds }),
  count: (count) => library().kindCounts.album(count),
};

/** Runs [run] with a mixed item's own kind and the item, typed for each other. */
const asOwnKind = <R>(
  mixed: Exclude<MixedItem, { readonly kind: "ytAlbum" }>,
  run: <T>(kind: KindInfo<T>, item: T) => R,
): R => (mixed.kind === "track" ? run(KIND_TRACK, mixed.item) : run(KIND_ALBUM, mixed.item));

const KINDS: { readonly [K in ItemKind]: KindInfo<ItemOf[K]> } = {
  track: KIND_TRACK,
  album: KIND_ALBUM,
  artist: {
    songs: (artist) => itemSongs("artists", artist.id),
    heading: (artist) => ({
      title: artist.name,
      subtitle: songCount(artist.trackCount),
      covers: undefined,
      artist,
    }),
    facts: () => NO_FACTS,
    count: (count) => library().kindCounts.artist(count),
  },
  // Genres have no picture; their headings are text only.
  playlist: {
    songs: (playlist) => itemSongs("playlists", playlist.id),
    heading: (playlist) => ({
      title: playlist.name,
      subtitle: songCount(playlist.trackCount),
      covers: playlist.thumbPaths,
    }),
    facts: (playlist) => ({ hasImage: playlist.hasImage }),
    count: (count) => library().kindCounts.playlist(count),
  },
  genre: {
    songs: (genre) => itemSongs("genres", genre.id),
    heading: (genre) => ({
      title: genre.name,
      subtitle: songCount(genre.trackCount),
      covers: undefined,
    }),
    facts: () => NO_FACTS,
    count: (count) => library().kindCounts.genre(count),
  },
  section: {
    songs: (section) => librarySectionSongs(section.slug),
    heading: (section, sectionSongs) => {
      const count = sectionSongs?.[section.slug];
      return {
        title: section.label,
        subtitle: count === undefined ? "" : songCount(count),
        covers: undefined,
      };
    },
    facts: () => NO_FACTS,
    count: (count) => library().kindCounts.section(count),
  },
  // Albums and songs checked together: each acts as its own kind would.
  mixed: {
    // `targetEntries` reads mixed targets itself (`resolveMixedEntries`); a release has no Library songs.
    songs: (mixed) =>
      mixed.kind === "ytAlbum"
        ? Promise.resolve([])
        : asOwnKind(mixed, (kind, item) => kind.songs(item)),
    heading: (mixed, sectionSongs) =>
      mixed.kind === "ytAlbum"
        ? {
            title: mixed.item.title,
            subtitle: joinArtists(mixed.item.artists),
            covers: cover(mixed.item.artworkUrl),
          }
        : asOwnKind(mixed, (kind, item) => kind.heading(item, sectionSongs)),
    // An album counts as its own album, so songs checked with it share it (Go to Album).
    facts: (mixed, favorites, find, pending) =>
      mixed.kind === "track"
        ? KIND_TRACK.facts(mixed.item, favorites, find, pending)
        : mixed.kind === "ytAlbum"
          ? { streamed: true, artistNames: mixed.item.artists }
          : { albumId: mixed.item.id, artistIds: mixed.item.albumArtistIds },
    count: (count) => library().kindCounts.item(count),
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
const targetSongs = async (target: ActionItems): Promise<readonly SongRow[]> => {
  const kind = kindInfo(target);
  const lists = await Promise.all(itemsOf(target).map((item) => kind.songs(item)));
  return target.kind === "track" ? lists.flat() : groupSongs(lists, songId);
};

/** A song an action acts on: a Library song, a YT Music song, streamed, or an unsearched one. */
export type TargetEntry = QueueSong<NativeYtSong, SongRow>;

/**
 * What the queue and playlist actions act on, with YT Music and unsearched
 * songs in their places: checked songs as they are, each playlist's entries
 * in playlist order (an entry two of them hold comes once), any other
 * target's songs as `targetSongs` gives them.
 */
export const targetEntries = async (target: ActionItems): Promise<readonly TargetEntry[]> => {
  if (target.kind === "track") return target.items.map(trackEntry);
  // Albums and songs checked together: each item's entries, a song two of them hold once.
  if (target.kind === "mixed")
    return resolveMixedEntries(target.items, {
      album: (album) => itemSongs("albums", album.id),
      release: async (album) => {
        const result = await askYtMusic((ytMusic) => ytMusic.album(album.browseId));
        if (Result.isFailure(result)) throw result.failure;
        return ytAlbumSongs(album.browseId, result.success);
      },
      finder: currentLibraryFinder,
    });
  if (target.kind !== "playlist")
    return (await targetSongs(target)).map((track) => ({ source: "library", track }));
  const lists = await Promise.all(target.items.map((playlist) => playlistEntries(playlist.id)));
  return groupSongs(
    lists.map((entries) =>
      // An unavailable entry has nothing to queue or add.
      entries.flatMap((entry): TargetEntry[] =>
        entry.source === "library"
          ? [{ source: "library", track: entry.track }]
          : entry.source === "stream"
            ? [{ source: "stream", song: entry.song }]
            : entry.source === "unsearched"
              ? [{ source: "unsearched", song: entry.song }]
              : [],
      ),
    ),
    queueSongTrackId,
  );
};

/** [entries] as songs a playlist takes (Core's `PlaylistSong`); an unsearched song stays unsearched. */
export const toPlaylistSongs = (entries: readonly TargetEntry[]): PlaylistSong[] =>
  entries.map((entry) =>
    entry.source === "library" ? { source: "library", trackId: entry.track.id } : entry,
  );

/**
 * What Core's `itemActions` needs to know about each of [target]'s items;
 * [pending] are the starred YT Music songs waiting for their files, by video.
 */
export const targetFacts = (
  target: ActionItems,
  favorites: ReadonlySet<number>,
  find: FindInLibrary,
  pending: ReadonlySet<string> = new Set(),
): readonly ActionItem[] => {
  const kind = kindInfo(target);
  return itemsOf(target).map((item) => kind.facts(item, favorites, find, pending));
};

/**
 * A collection's Library [songs] as Core's `itemActions` sees them
 * (`ActionItem.songs`): whether each is missing, and whether Fix Song can do
 * something for it.
 */
export const collectionSongFacts = (songs: readonly SongRow[]): ActionItem[] =>
  songs.map((song) => ({ missing: song.path === null, fixable: canFixSong(song) }));

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
  kindInfo(target).count(target.items.length);
