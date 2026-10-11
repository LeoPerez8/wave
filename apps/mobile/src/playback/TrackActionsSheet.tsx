import { usePathname } from "expo-router";
import { useSyncExternalStore } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Artwork } from "@/catalog/Artwork";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { LibraryStore, type AlbumRow, type ArtistRow, type SongRow } from "@/library/LibraryStore";
import { albumHref, artistHref, openAlbum, openArtist } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { makeExternalStore } from "@/lib/externalStore";

import { addToQueue, playNext } from "./actions";

/** What a long-press menu is about. */
export type ActionTarget =
  | { readonly kind: "track"; readonly song: SongRow }
  | { readonly kind: "album"; readonly album: AlbumRow }
  | { readonly kind: "artist"; readonly artist: ArtistRow };

const openTarget = makeExternalStore<ActionTarget | null>(null);

/** Opens the long-press menu for a track. */
export const openTrackActions = (song: SongRow): void => openTarget.set({ kind: "track", song });

/** Opens the long-press menu for an album (Play Next and Add to Queue take the whole album). */
export const openAlbumActions = (album: AlbumRow): void => openTarget.set({ kind: "album", album });

/** Opens the long-press menu for an artist (their songs, in the artist screen's order). */
export const openArtistActions = (artist: ArtistRow): void =>
  openTarget.set({ kind: "artist", artist });

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
  }
};

const plural = (count: number, word: string): string =>
  `${count.toLocaleString("en")} ${count === 1 ? word : `${word}s`}`;

const heading = (
  target: ActionTarget,
): { title: string; subtitle: string; thumbPath: string | null | undefined } => {
  switch (target.kind) {
    case "track":
      return {
        title: target.song.title,
        subtitle: target.song.artist,
        thumbPath: target.song.thumbPath,
      };
    case "album":
      return {
        title: target.album.title,
        subtitle: target.album.albumArtist,
        thumbPath: target.album.thumbPath,
      };
    case "artist":
      return {
        title: target.artist.name,
        subtitle: plural(target.artist.trackCount, "song"),
        // Artists have no picture; the heading is text only.
        thumbPath: undefined,
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
      return {};
  }
};

/**
 * The long-press menu for a track, an album or an artist: what it is, then one
 * quiet line per action. Flat, square and set on the ground over a 90% ground
 * veil, like the spine's letter field. Mounted once at the root.
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
            {head.thumbPath !== undefined && (
              <Artwork
                uri={head.thumbPath === null ? undefined : `file://${head.thumbPath}`}
                size={CELL * 5}
              />
            )}
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
          {albumId !== undefined && pathname !== albumHref(albumId) && (
            <EntryRow label="Go to Album" onPress={go(() => openAlbum(albumId))} />
          )}
          {artistId !== undefined && pathname !== artistHref(artistId) && (
            <EntryRow label="Go to Artist" onPress={go(() => openArtist(artistId))} />
          )}
        </View>
      )}
    </Modal>
  );
}
