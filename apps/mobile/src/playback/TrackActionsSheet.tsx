import { useSyncExternalStore } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Artwork } from "@/catalog/Artwork";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import type { SongRow } from "@/library/LibraryStore";
import { makeExternalStore } from "@/lib/externalStore";

import { addToQueue, playNext } from "./actions";

const openTrack = makeExternalStore<SongRow | null>(null);

/** Opens the long-press menu for a track. */
export const openTrackActions = (song: SongRow): void => openTrack.set(song);

const close = (): void => openTrack.set(null);

/**
 * A track's long-press menu: the track, then one quiet line per action.
 * Flat, square and set on the ground over a 90% ground veil, like the spine's
 * letter field. Mounted once at the root.
 */
export function TrackActionsSheet() {
  const song = useSyncExternalStore(openTrack.subscribe, openTrack.get);
  const insets = useSafeAreaInsets();

  const act = (action: (songs: readonly SongRow[]) => void) => () => {
    if (song !== null) action([song]);
    close();
  };

  return (
    <Modal
      visible={song !== null}
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
      {song !== null && (
        <View
          className="bg-background"
          style={{ paddingHorizontal: grid.margin, paddingBottom: insets.bottom + CELL * 2 }}
        >
          <Hairline />
          <View
            className="flex-row items-center"
            style={{ height: grid.row + CELL * 2, gap: CELL * 1.5 }}
          >
            <Artwork
              uri={song.thumbPath === null ? undefined : `file://${song.thumbPath}`}
              size={CELL * 5}
            />
            <View className="flex-1">
              <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
                {song.title}
              </Text>
              <Text numberOfLines={1} className="font-sans text-body text-secondary">
                {song.artist}
              </Text>
            </View>
          </View>
          <Hairline />
          <EntryRow label="Play Next" onPress={act(playNext)} />
          <EntryRow label="Add to Queue" onPress={act(addToQueue)} />
        </View>
      )}
    </Modal>
  );
}
