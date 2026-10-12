import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { Mosaic } from "@/catalog/Mosaic";
import type { LibrarySection } from "@/catalog/sections";
import { setFavorite, useIsFavorite } from "@/library/favorites";
import {
  LibraryStore,
  type AlbumRow,
  type ArtistRow,
  type FolderRow,
  type GenreRow,
  type PlaylistRow,
  type SongRow,
} from "@/library/LibraryStore";
import {
  confirmDeletePlaylist,
  openAddToPlaylist,
  renamePlaylistFlow,
} from "@/library/PlaylistSheets";
import { removePlaylistItem } from "@/library/playlists";
import { albumHref, artistHref, openAlbum, openArtist, playlistHref } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { librarySectionSongs } from "@/library/sectionSongs";
import { pressedRect } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";

import { addToQueue, playNext } from "./actions";

/** A track's place in the playlist its menu was opened from. */
export interface PlaylistPlace {
  readonly playlistId: number;
  readonly itemId: number;
}

/** What a long-press menu is about. */
export type ActionTarget =
  | {
      readonly kind: "track";
      readonly song: SongRow;
      /** Set when opened from a playlist: offers Remove from Playlist. */
      readonly playlistItem?: PlaylistPlace | undefined;
    }
  | { readonly kind: "album"; readonly album: AlbumRow }
  | { readonly kind: "artist"; readonly artist: ArtistRow }
  | { readonly kind: "playlist"; readonly playlist: PlaylistRow }
  | { readonly kind: "genre"; readonly genre: GenreRow }
  | { readonly kind: "folder"; readonly folder: FolderRow }
  | {
      readonly kind: "section";
      readonly section: LibrarySection;
      /** Every song the section holds, in its order; loading starts as the menu opens. */
      readonly songs: Promise<readonly SongRow[]>;
    };

/**
 * Floats the menu next to the row (or button) whose press opened it, centred
 * when opened some other way.
 */
const openActions = (target: ActionTarget): void => {
  openOverlay({
    label: heading(target, undefined).title,
    anchor: pressedRect(),
    render: (close) => <ActionsMenu target={target} close={close} />,
  });
};

/** Opens the long-press menu for a track (in a playlist, pass its place there). */
export const openTrackActions = (song: SongRow, playlistItem?: PlaylistPlace): void =>
  openActions({ kind: "track", song, playlistItem });

/** Opens the menu for a playlist: queue it, add it to another, rename or delete it. */
export const openPlaylistActions = (playlist: PlaylistRow): void =>
  openActions({ kind: "playlist", playlist });

/** Opens the long-press menu for an album (Play Next and Add to Queue take the whole album). */
export const openAlbumActions = (album: AlbumRow): void => openActions({ kind: "album", album });

/** Opens the long-press menu for an artist (their songs, in the artist screen's order). */
export const openArtistActions = (artist: ArtistRow): void =>
  openActions({ kind: "artist", artist });

/** Opens the long-press menu for a genre (its songs, in the genre screen's order). */
export const openGenreActions = (genre: GenreRow): void => openActions({ kind: "genre", genre });

/** Opens the long-press menu for a folder (its songs, in the folder screen's order). */
export const openFolderActions = (folder: FolderRow): void =>
  openActions({ kind: "folder", folder });

/** Opens the menu for a Library entry (Songs, Albums…): every song it holds, in its order. */
export const openLibrarySectionActions = (section: LibrarySection): void =>
  openActions({ kind: "section", section, songs: librarySectionSongs(section.slug) });

/** The tracks a menu's queue actions act on, in play order. */
export const targetSongs = (target: ActionTarget): Promise<readonly SongRow[]> => {
  switch (target.kind) {
    case "track":
      return Promise.resolve([target.song]);
    case "album":
      return appRuntime
        .runPromise(LibraryStore.use((store) => store.getAlbum(target.album.id)))
        .then((detail) => detail?.tracks ?? []);
    case "artist":
      return appRuntime
        .runPromise(LibraryStore.use((store) => store.getArtist(target.artist.id)))
        .then((detail) => detail?.songs ?? []);
    case "playlist":
      return appRuntime
        .runPromise(LibraryStore.use((store) => store.getPlaylist(target.playlist.id)))
        .then((detail) => detail?.items ?? []);
    case "genre":
      return appRuntime
        .runPromise(LibraryStore.use((store) => store.getGenre(target.genre.id)))
        .then((detail) => detail?.songs ?? []);
    case "folder":
      return appRuntime
        .runPromise(LibraryStore.use((store) => store.getFolder(target.folder.id)))
        .then((detail) => detail?.songs ?? []);
    case "section":
      return target.songs;
  }
};

const plural = (count: number, word: string): string =>
  `${count.toLocaleString("en")} ${count === 1 ? word : `${word}s`}`;

const cover = (thumbPath: string | null): readonly string[] =>
  thumbPath === null ? [] : [thumbPath];

const heading = (
  target: ActionTarget,
  /** How many songs a Library entry holds, once known. */
  songCount: number | undefined,
): { title: string; subtitle: string; covers: readonly string[] | undefined } => {
  switch (target.kind) {
    case "track":
      return {
        title: target.song.title,
        subtitle: target.song.artist,
        covers: cover(target.song.thumbPath),
      };
    case "album":
      return {
        title: target.album.title,
        subtitle: target.album.albumArtist,
        covers: cover(target.album.thumbPath),
      };
    case "artist":
      return {
        title: target.artist.name,
        subtitle: plural(target.artist.trackCount, "song"),
        // Artists have no picture; the heading is text only.
        covers: undefined,
      };
    case "playlist":
      return {
        title: target.playlist.name,
        subtitle: plural(target.playlist.trackCount, "song"),
        covers: target.playlist.thumbPaths,
      };
    case "genre":
      return {
        title: target.genre.name,
        subtitle: plural(target.genre.trackCount, "song"),
        // Genres have no picture; the heading is text only.
        covers: undefined,
      };
    case "folder":
      return {
        title: target.folder.name,
        subtitle: plural(target.folder.trackCount, "song"),
        // Folders have no picture; the heading is text only.
        covers: undefined,
      };
    case "section":
      return {
        title: target.section.label,
        subtitle: songCount === undefined ? "" : plural(songCount, "song"),
        covers: undefined,
      };
  }
};

/** Where Go to Album / Go to Artist lead, if anywhere. */
const destinations = (target: ActionTarget): { albumId?: number; artistId?: number } => {
  switch (target.kind) {
    case "track":
      return { albumId: target.song.albumId, artistId: target.song.artistId };
    case "album":
      return { artistId: target.album.albumArtistId };
    case "artist":
    case "playlist":
    case "genre":
    case "folder":
    case "section":
      return {};
  }
};

/** How many songs a Library entry's menu acts on, once they have loaded. */
function useSectionSongCount(target: ActionTarget): number | undefined {
  const songs = target.kind === "section" ? target.songs : undefined;
  const [loaded, setLoaded] = useState<{ songs: Promise<unknown>; count: number }>();
  useEffect(() => {
    if (songs === undefined) return;
    let live = true;
    songs.then(
      (list) => {
        if (live) setLoaded({ songs, count: list.length });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [songs]);
  return loaded !== undefined && loaded.songs === songs ? loaded.count : undefined;
}

/** One line of the menu. */
interface MenuEntry {
  readonly label: string;
  readonly onPress: () => void;
}

/**
 * The long-press menu for a track, an album, an artist, a playlist, a genre, a
 * folder or a Library entry: what it is, then one quiet line per action. A
 * glass card on the overlay, floating next to the row it was opened from.
 */
function ActionsMenu({ target, close }: { target: ActionTarget; close: () => void }) {
  const pathname = usePathname();
  const sectionSongCount = useSectionSongCount(target);
  const song = target.kind === "track" ? target.song : null;
  // Stars stay in sync everywhere.
  const favorite = useIsFavorite(song?.id ?? null);

  const queue = (action: (songs: readonly SongRow[]) => void) => () => {
    void targetSongs(target).then(action);
    close();
  };

  const go = (open: () => void) => () => {
    close();
    open();
  };

  const head = heading(target, sectionSongCount);
  const { albumId, artistId } = destinations(target);
  const place = target.kind === "track" ? target.playlistItem : undefined;

  const entries: readonly MenuEntry[] = [
    { label: "Play Next", onPress: queue(playNext) },
    { label: "Add to Queue", onPress: queue(addToQueue) },
    {
      label: "Add to Playlist",
      onPress: go(() => openAddToPlaylist({ title: head.title, songs: () => targetSongs(target) })),
    },
    ...(song === null
      ? []
      : [
          {
            label: favorite ? "Remove from Favorites" : "Favorite",
            onPress: () => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void setFavorite(song.id, !favorite);
              close();
            },
          },
        ]),
    ...(place === undefined
      ? []
      : [
          {
            label: "Remove from Playlist",
            onPress: go(() => void removePlaylistItem(place.playlistId, place.itemId)),
          },
        ]),
    ...(albumId === undefined || pathname === albumHref(albumId)
      ? []
      : [{ label: "Go to Album", onPress: go(() => openAlbum(albumId)) }]),
    ...(artistId === undefined || pathname === artistHref(artistId)
      ? []
      : [{ label: "Go to Artist", onPress: go(() => openArtist(artistId)) }]),
    ...(target.kind === "playlist"
      ? [
          {
            label: "Rename Playlist",
            onPress: go(() => void renamePlaylistFlow(target.playlist)),
          },
          {
            label: "Delete Playlist",
            onPress: go(() =>
              confirmDeletePlaylist(target.playlist, () => {
                // Leave the playlist's screen once it's gone.
                if (pathname === playlistHref(target.playlist.id)) router.back();
              }),
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <View
        className="flex-row items-center"
        style={{ paddingBottom: CELL * 1.5, gap: CELL * 1.5 }}
      >
        {head.covers !== undefined && <Mosaic paths={head.covers} size={CELL * 5} />}
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {head.title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {head.subtitle}
          </Text>
        </View>
      </View>
      <Hairline />
      {/* Scrolls only where the card can't fit every entry (small windows, landscape). */}
      <ScrollView bounces={false} overScrollMode="never">
        {entries.map((entry, index) => (
          <EntryRow
            key={entry.label}
            label={entry.label}
            onPress={entry.onPress}
            divider={index < entries.length - 1}
          />
        ))}
      </ScrollView>
    </>
  );
}
