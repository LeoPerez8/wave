import type { QueueContext } from "@wave/core";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { AlbumTile } from "@/catalog/AlbumTile";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { TextButton } from "@/components/TextButton";
import { toAlbumSummary } from "@/library/AlbumGrid";
import { useFavoriteIds } from "@/library/favorites";
import type { AlbumRow, SongRow } from "@/library/LibraryStore";
import { openAlbum } from "@/library/routes";
import { toTrackSummary } from "@/library/TrackList";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openAlbumActions, openTrackActions } from "@/playback/ActionsMenu";
import { useListScrollable } from "@/motion/heldTouch";

/** Shelf covers leave the next one peeking in at the right edge, so the row reads as scrollable. */
const SHELF_TILE = CELL * 19;

/** A Home section: its catalog line (with an optional action), then its content. */
export function HomeSection({
  title,
  action,
  first = false,
  children,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
  /** The first section sits closer to the large title. */
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ marginTop: first ? CELL : CELL * 5, gap: CELL * 1.5 }}>
      <View className="flex-row items-center justify-between" style={{ minHeight: CELL * 6 }}>
        <View className="flex-1">
          <CatalogLine>{title}</CatalogLine>
        </View>
        {action !== undefined && <TextButton label={action.label} onPress={action.onPress} />}
      </View>
      {children}
    </View>
  );
}

/** A row of album covers that scrolls sideways, edge to edge. */
export function AlbumShelf({ albums }: { albums: readonly AlbumRow[] }) {
  const scrollable = useListScrollable();
  return (
    <ScrollView
      scrollEnabled={scrollable}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -grid.margin }}
      contentContainerStyle={{ paddingHorizontal: grid.margin, gap: grid.gutter }}
    >
      {albums.map((album) => (
        <AlbumTile
          key={album.id}
          album={toAlbumSummary(album)}
          size={SHELF_TILE}
          onPress={() => openAlbum(album.id)}
          onLongPress={() => openAlbumActions(album)}
        />
      ))}
    </ScrollView>
  );
}

/**
 * A short list of songs (Most Played, Favorites). Tapping one plays the list
 * from it; long-press opens the track's menu.
 */
export function SongRows<A extends SongRow>({
  songs,
  context,
  artistLine,
}: {
  songs: readonly A[];
  context: QueueContext;
  /** The second line; the artist by default. */
  artistLine?: (song: A) => string;
}) {
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  return (
    <View>
      {songs.map((song, index) => (
        <TrackRow
          key={song.id}
          track={{
            ...toTrackSummary(song),
            artist: artistLine === undefined ? song.artist : artistLine(song),
          }}
          state={String(song.id) === currentId ? "playing" : undefined}
          favorite={favorites.has(song.id)}
          leading="artwork"
          onPress={() => playSongs(songs, index, context)}
          onLongPress={() => openTrackActions(song)}
        />
      ))}
    </View>
  );
}
