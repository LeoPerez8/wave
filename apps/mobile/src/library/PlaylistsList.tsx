import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { IconPlaylist } from "@tabler/icons-react-native";
import { useScrollToTop } from "expo-router";
import { useRef } from "react";
import { View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { PlaylistEntry } from "@/catalog/PlaylistEntry";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { TextButton } from "@/components/TextButton";
import { openPlaylistActions } from "@/playback/ActionsMenu";

import { usePlaylists } from "./hooks";
import type { PlaylistRow } from "./LibraryStore";
import { newPlaylist } from "./PlaylistSheets";
import { openPlaylist } from "./routes";
import { songCount } from "./TrackList";
import { useListScrollable } from "@/motion/heldTouch";

/** Makes an empty playlist and opens it. */
const createAndOpen = (): void => {
  void newPlaylist().then((id) => {
    if (id !== null) openPlaylist(id);
  });
};

const keyOf = (playlist: PlaylistRow): string => String(playlist.id);

const renderPlaylist = ({ item }: { item: PlaylistRow }) => (
  <PlaylistEntry
    name={item.name}
    detail={songCount(item.trackCount)}
    paths={item.thumbPaths}
    onPress={() => openPlaylist(item.id)}
    onLongPress={() => openPlaylistActions(item)}
  />
);

/** Library › Playlists: every playlist by name, with New Playlist above them. */
export function PlaylistsList({ empty }: { empty: string }) {
  const scrollable = useListScrollable();
  const playlists = usePlaylists();
  const bottomInset = useChromeInset();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);

  if (playlists.length === 0) {
    return (
      <View style={{ paddingHorizontal: grid.margin }}>
        <EmptyState
          icon={IconPlaylist}
          title="No playlists"
          message={empty}
          action={<TextButton label="New Playlist" opensMenu onPress={createAndOpen} />}
        />
      </View>
    );
  }

  return (
    <LegendList
      ref={list}
      scrollEnabled={scrollable}
      className="flex-1"
      data={playlists}
      keyExtractor={keyOf}
      renderItem={renderPlaylist}
      estimatedItemSize={grid.row}
      getFixedItemSize={() => grid.row}
      recycleItems
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      ListHeaderComponent={
        <View className="flex-row items-center" style={{ paddingBottom: CELL }}>
          <View className="flex-1">
            <CatalogLine>
              {`${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}`}
            </CatalogLine>
          </View>
          <TextButton label="New Playlist" opensMenu onPress={createAndOpen} />
        </View>
      }
    />
  );
}
