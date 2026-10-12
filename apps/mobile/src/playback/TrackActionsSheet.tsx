import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";
import { useSyncExternalStore } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { Mosaic } from "@/catalog/Mosaic";
import { setFavorite, useIsFavorite } from "@/library/favorites";
import {
  LibraryStore,
  type AlbumRow,
  type ArtistRow,
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
import { makeExternalStore } from "@/lib/externalStore";

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
  | { readonly kind: "genre"; readonly genre: GenreRow };

const openTarget = makeExternalStore<ActionTarget | null>(null);

/** Opens the long-press menu for a track (in a playlist, pass its place there). */
export const openTrackActions = (song: SongRow, playlistItem?: PlaylistPlace): void =>
  openTarget.set({ kind: "track", song, playlistItem });

/** Opens the menu for a playlist: queue it, add it to another, rename or delete it. */
export const openPlaylistActions = (playlist: PlaylistRow): void =>
  openTarget.set({ kind: "playlist", playlist });

/** Opens the long-press menu for an album (Play Next and Add to Queue take the whole album). */
export const openAlbumActions = (album: AlbumRow): void => openTarget.set({ kind: "album", album });

/** Opens the long-press menu for an artist (their songs, in the artist screen's order). */
export const openArtistActions = (artist: ArtistRow): void =>
  openTarget.set({ kind: "artist", artist });

/** Opens the long-press menu for a genre (its songs, in the genre screen's order). */
export const openGenreActions = (genre: GenreRow): void => openTarget.set({ kind: "genre", genre });

const close = (): void => openTarget.set(null);

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
  }
};

const plural = (count: number, word: string): string =>
  `${count.toLocaleString("en")} ${count === 1 ? word : `${word}s`}`;

const cover = (thumbPath: string | null): readonly string[] =>
  thumbPath === null ? [] : [thumbPath];

const heading = (
  target: ActionTarget,
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
      return {};
  }
};

/** Favorite / Remove from Favorites for a track; stars stay in sync everywhere. */
function FavoriteEntry({ song, onDone }: { song: SongRow; onDone: () => void }) {
  const favorite = useIsFavorite(song.id);
  return (
    <EntryRow
      label={favorite ? "Remove from Favorites" : "Favorite"}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        void setFavorite(song.id, !favorite);
        onDone();
      }}
    />
  );
}

/**
 * The long-press menu for a track, an album, an artist, a playlist or a genre: what it
 * is, then one quiet line per action. Flat, square and set on the ground over
 * a 90% ground veil, like the spine's letter field. Mounted once at the root.
 */
export function TrackActionsSheet() {
  const target = useSyncExternalStore(openTarget.subscribe, openTarget.get);
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const queue = (action: (songs: readonly SongRow[]) => void) => () => {
    if (target !== null) void targetSongs(target).then(action);
    close();
  };

  const go = (open: () => void) => () => {
    close();
    open();
  };

  const head = target === null ? null : heading(target);
  const { albumId, artistId } = target === null ? {} : destinations(target);
  const place = target?.kind === "track" ? target.playlistItem : undefined;

  return (
    <Modal
      visible={target !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <Pressable
        className="flex-1 bg-background/90"
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={close}
      />
      {head !== null && (
        <View
          className="bg-background"
          style={{ paddingHorizontal: grid.margin, paddingBottom: insets.bottom + CELL * 2 }}
        >
          <Hairline />
          <View
            className="flex-row items-center"
            style={{ height: grid.row + CELL * 2, gap: CELL * 1.5 }}
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
          <EntryRow label="Play Next" onPress={queue(playNext)} />
          <EntryRow label="Add to Queue" onPress={queue(addToQueue)} />
          {target !== null && (
            <EntryRow
              label="Add to Playlist"
              onPress={go(() =>
                openAddToPlaylist({ title: head.title, songs: () => targetSongs(target) }),
              )}
            />
          )}
          {target?.kind === "track" && <FavoriteEntry song={target.song} onDone={close} />}
          {place !== undefined && (
            <EntryRow
              label="Remove from Playlist"
              onPress={go(() => void removePlaylistItem(place.playlistId, place.itemId))}
            />
          )}
          {albumId !== undefined && pathname !== albumHref(albumId) && (
            <EntryRow label="Go to Album" onPress={go(() => openAlbum(albumId))} />
          )}
          {artistId !== undefined && pathname !== artistHref(artistId) && (
            <EntryRow label="Go to Artist" onPress={go(() => openArtist(artistId))} />
          )}
          {target?.kind === "playlist" && (
            <>
              <EntryRow
                label="Rename Playlist"
                onPress={go(() => void renamePlaylistFlow(target.playlist))}
              />
              <EntryRow
                label="Delete Playlist"
                onPress={go(() =>
                  confirmDeletePlaylist(target.playlist, () => {
                    // Leave the playlist's screen once it's gone.
                    if (pathname === playlistHref(target.playlist.id)) router.back();
                  }),
                )}
              />
            </>
          )}
        </View>
      )}
    </Modal>
  );
}
