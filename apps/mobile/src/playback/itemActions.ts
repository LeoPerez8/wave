import {
  confirmsFirst,
  groupSongs,
  isDestructiveAction,
  isDetailPath,
  ITEM_ACTION_LABELS,
  itemActions,
  type ActionItem,
  type ActionSurface,
  type ItemAction,
  type ItemKind,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";

import type { ArtistImageSource } from "@/catalog/ArtistImage";
import type { LibrarySection } from "@/catalog/sections";
import type { LibraryCounts } from "@/library/db/counts";
import { confirmDeleteSongs } from "@/library/deleteSongs";
import { setFavorites, useFavoriteIds } from "@/library/favorites";
import type {
  AlbumRow,
  ArtistRow,
  FolderRow,
  GenreRow,
  PlaylistRow,
  SongRow,
} from "@/library/LibraryStore";
import {
  confirmDeletePlaylist,
  openAddToPlaylist,
  renamePlaylistFlow,
} from "@/library/PlaylistSheets";
import { removePlaylistItem } from "@/library/playlists";
import { openAlbum, openArtist } from "@/library/routes";
import { itemSongs, librarySectionSongs } from "@/library/sectionSongs";
import { showError } from "@/overlay/alert";

import { addToQueue, playNext } from "./actions";

/**
 * Wave's actions on library items, defined once for the long-press menu (one
 * item) and the selection bar (the checked items): Core's `itemActions`
 * decides which entries show, this module what each one does.
 */

/** A track's place in the playlist its menu was opened from. */
export interface PlaylistPlace {
  readonly playlistId: number;
  readonly itemId: number;
}

/** A track as the actions see it: the song, and its place when shown in a playlist. */
export interface TrackItem {
  readonly song: SongRow;
  /** Set in a playlist: offers Remove from Playlist. */
  readonly playlistItem?: PlaylistPlace | undefined;
}

/** The item type of each kind. */
export interface ItemOf {
  readonly track: TrackItem;
  readonly album: AlbumRow;
  readonly artist: ArtistRow;
  readonly playlist: PlaylistRow;
  readonly genre: GenreRow;
  readonly folder: FolderRow;
  readonly section: LibrarySection;
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

const plural = (count: number, word: string): string =>
  `${count.toLocaleString("en")} ${count === 1 ? word : `${word}s`}`;

const cover = (thumbPath: string | null): readonly string[] =>
  thumbPath === null ? [] : [thumbPath];

const NO_FACTS: ActionItem = {};

const KINDS: { readonly [K in ItemKind]: KindInfo<ItemOf[K]> } = {
  track: {
    songs: ({ song }) => Promise.resolve([song]),
    heading: ({ song }) => ({
      title: song.title,
      subtitle: song.artist,
      covers: cover(song.thumbPath),
    }),
    facts: ({ song, playlistItem }, favorites) => ({
      albumId: song.albumId,
      artistId: song.artistId,
      favorite: favorites.has(song.id),
      inPlaylist: playlistItem !== undefined,
    }),
    noun: "song",
  },
  album: {
    songs: (album) => itemSongs("albums", album.id),
    heading: (album) => ({
      title: album.title,
      subtitle: album.albumArtist,
      covers: cover(album.thumbPath),
    }),
    facts: (album) => ({ artistId: album.albumArtistId }),
    noun: "album",
  },
  artist: {
    songs: (artist) => itemSongs("artists", artist.id),
    heading: (artist) => ({
      title: artist.name,
      subtitle: plural(artist.trackCount, "song"),
      covers: undefined,
      artist,
    }),
    facts: () => NO_FACTS,
    noun: "artist",
  },
  // Genres and folders have no picture; their headings are text only.
  playlist: {
    songs: (playlist) => itemSongs("playlists", playlist.id),
    heading: (playlist) => ({
      title: playlist.name,
      subtitle: plural(playlist.trackCount, "song"),
      covers: playlist.thumbPaths,
    }),
    facts: () => NO_FACTS,
    noun: "playlist",
  },
  genre: {
    songs: (genre) => itemSongs("genres", genre.id),
    heading: (genre) => ({
      title: genre.name,
      subtitle: plural(genre.trackCount, "song"),
      covers: undefined,
    }),
    facts: () => NO_FACTS,
    noun: "genre",
  },
  folder: {
    songs: (folder) => itemSongs("folders", folder.id),
    heading: (folder) => ({
      title: folder.name,
      subtitle: plural(folder.trackCount, "song"),
      covers: undefined,
    }),
    facts: () => NO_FACTS,
    noun: "folder",
  },
  section: {
    songs: (section) => librarySectionSongs(section.slug),
    heading: (section, sectionSongs) => {
      const count = sectionSongs?.[section.slug];
      return {
        title: section.label,
        subtitle: count === undefined ? "" : plural(count, "song"),
        covers: undefined,
      };
    },
    facts: () => NO_FACTS,
    noun: "section",
  },
};

/** The kind's info, typed for its items (TypeScript can't correlate the union on its own). */
const kindOf = <K extends ItemKind>(kind: K): KindInfo<ItemOf[K]> =>
  KINDS[kind] as unknown as KindInfo<ItemOf[K]>;

type Items = { readonly kind: ItemKind; readonly items: readonly unknown[] };

const info = (target: ActionItems): KindInfo<unknown> =>
  kindOf(target.kind) as unknown as KindInfo<unknown>;

const songId = (song: SongRow): number => song.id;

/**
 * The songs the queue actions act on: each item's, in the items' order. Groups
 * (albums, artists…) expand by Core's `groupSongs`: a song two of them hold
 * comes once; checked tracks are taken as they are.
 */
export const targetSongs = async (target: ActionItems): Promise<readonly SongRow[]> => {
  const kind = info(target);
  const lists = await Promise.all((target as Items).items.map((item) => kind.songs(item)));
  return target.kind === "track" ? lists.flat() : groupSongs(lists, songId);
};

/** A menu's heading: what its one item is. */
export const targetHeading = (
  target: ActionItems,
  sectionSongs: LibraryCounts | undefined,
): Heading | undefined => {
  const first = (target as Items).items[0];
  return first === undefined ? undefined : info(target).heading(first, sectionSongs);
};

/** "12 songs", "3 albums": what a count of the target's items is called. */
export const targetCount = (target: ActionItems): string =>
  plural(target.items.length, info(target).noun);

/** One entry, as a menu row or a bar button shows it. */
export interface ActionEntry {
  readonly action: ItemAction;
  readonly label: string;
  readonly onPress: () => void;
  /** Deletes something for good: shown in the destructive colour. */
  readonly destructive: boolean;
}

export interface ActionOptions {
  readonly surface: ActionSurface;
  /** Runs before an entry's action: the menu closes, the selection ends. */
  readonly finish: () => void;
  /** The menu's list can select: offers Select, which calls this. */
  readonly onSelect?: (() => void) | undefined;
}

/**
 * The entries to show for [target] (Core decides which), each wired to what it
 * does. [target] is resolved when an entry runs, so a bar can pass the
 * selection as it is at that moment.
 */
export function useItemActions(
  target: ActionItems,
  { surface, finish, onSelect }: ActionOptions,
): readonly ActionEntry[] {
  const here = usePathname();
  const favorites = useFavoriteIds();
  const kind = info(target);
  const items = (target as Items).items;
  const facts = items.map((item) => kind.facts(item, favorites));
  const tracks = target.kind === "track" ? target.items : [];

  const run = (action: () => void) => () => {
    finish();
    action();
  };

  const queue = (add: (songs: readonly SongRow[]) => void) =>
    run(() => {
      targetSongs(target)
        .then(add)
        .catch((error: unknown) => showError("Couldn't load the songs", error));
    });

  const star = (on: boolean) =>
    run(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void setFavorites(
        tracks.map(({ song }) => song.id),
        on,
      );
    });

  const playlist = target.kind === "playlist" ? target.items[0] : undefined;
  const addTitle =
    surface === "menu"
      ? (targetHeading(target, undefined)?.title ?? targetCount(target))
      : targetCount(target);

  return itemActions({
    kind: target.kind,
    items: facts,
    surface,
    selectable: onSelect !== undefined,
    here,
  }).map((entry): ActionEntry => {
    const label = ITEM_ACTION_LABELS[entry.action];
    const make = (onPress: () => void): ActionEntry => ({
      action: entry.action,
      label,
      onPress,
      destructive: isDestructiveAction(entry.action),
    });
    switch (entry.action) {
      case "playNext":
        return make(queue(playNext));
      case "addToQueue":
        return make(queue(addToQueue));
      case "addToPlaylist":
        return make(
          run(() => openAddToPlaylist({ title: addTitle, songs: () => targetSongs(target) })),
        );
      case "favorite":
        return make(star(true));
      case "unfavorite":
        return make(star(false));
      case "removeFromPlaylist":
        return make(
          run(() => {
            for (const { playlistItem } of tracks) {
              if (playlistItem !== undefined)
                void removePlaylistItem(playlistItem.playlistId, playlistItem.itemId);
            }
          }),
        );
      case "goToAlbum": {
        const { albumId } = entry;
        return make(run(() => openAlbum(albumId)));
      }
      case "goToArtist": {
        const { artistId } = entry;
        return make(run(() => openArtist(artistId)));
      }
      case "renamePlaylist":
        return make(run(() => playlist !== undefined && void renamePlaylistFlow(playlist)));
      case "deletePlaylist":
        return make(
          run(() => {
            if (playlist === undefined) return;
            confirmDeletePlaylist(playlist, () => {
              // Leave the playlist's screen once it's gone.
              if (isDetailPath(here, "playlist", playlist.id)) router.back();
            });
          }),
        );
      case "select":
        return make(run(() => onSelect?.()));
      case "delete": {
        const songs = tracks.map(({ song }) => song);
        // It asks first: selection mode ends only once confirmed, so Cancel keeps it.
        return make(
          surface === "selection" && confirmsFirst(entry.action)
            ? () => void confirmDeleteSongs(songs, { onConfirm: finish })
            : run(() => void confirmDeleteSongs(songs)),
        );
      }
    }
  });
}
