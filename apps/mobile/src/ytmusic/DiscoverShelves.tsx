import {
  discoverItemAction,
  discoverTileCaption,
  discoverTrackId,
  type DiscoverAction,
  type DiscoverItem,
  type DiscoverShelf,
  type DiscoverSong,
  type QueueContext,
} from "@wave/core";
import { ScrollView, useWindowDimensions, View } from "react-native";

import { AlbumTile } from "@/catalog/AlbumTile";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL, grid } from "@/catalog/grid";
import { TitledSection } from "@/catalog/TitledSection";
import { TrackRow } from "@/catalog/TrackRow";
import { useFavoriteIds } from "@/library/favorites";
import type { SongRow } from "@/library/LibraryStore";
import { toTrackSummary } from "@/library/TrackList";
import { useListScrollable } from "@/motion/heldTouch";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openTrackActions } from "@/playback/ActionsMenu";
import { playDiscoverSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { listedTrackItem, trackItemKey, tracksTarget, type TrackItem } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";
import { useMemo } from "react";

import { openYtAlbum, openYtPlaylist } from "./routes";
import { openYtAlbumActions } from "./YtAlbumActions";
import { openYtSongActions } from "./YtSongActions";
import { YtSongRow } from "./YtSongRow";

type Song = DiscoverSong<NativeYtSong, SongRow>;
type Shelf = DiscoverShelf<NativeYtSong, SongRow>;
type Item = DiscoverItem<NativeYtSong, SongRow>;

/** Runs what tapping a Discover item does (Core's `discoverItemAction`). */
export const runDiscoverAction = (
  action: DiscoverAction<NativeYtSong, SongRow> | null,
  context: QueueContext,
  head?: { readonly line: string; readonly artworkUrl: string | null },
): void => {
  switch (action?.type) {
    case undefined:
      return;
    case "play":
      void playDiscoverSongs(action.songs, action.startIndex, context);
      return;
    case "openAlbum":
      openYtAlbum(action.browseId, {
        title: action.title,
        line: head?.line ?? "",
        artworkUrl: head?.artworkUrl ?? null,
      });
      return;
    case "openPlaylist":
      openYtPlaylist(action.playlistId, {
        title: action.title,
        line: head?.line ?? "",
        artworkUrl: head?.artworkUrl ?? null,
      });
      return;
  }
};

/**
 * A Discover song as a Songs-list row: the Library track (its star, its
 * menu) when the Library has it, else the YT Music song, streamed.
 */
export function DiscoverSongRow({
  song,
  onPress,
  trackNumber,
  selection,
}: {
  song: Song;
  onPress: () => void;
  /** Leads with this number instead of the cover (an album's tracklist). */
  trackNumber?: number | undefined;
  selection?: ListSelection<TrackItem> | undefined;
}) {
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const playing = discoverTrackId(song) === currentId;
  if (song.source === "stream")
    return (
      <YtSongRow song={song.song} playing={playing} trackNumber={trackNumber}
        {...selectableRow(listedTrackItem(song), selection, onPress,
          (options) => openYtSongActions(song.song, options))} />
    );
  return (
    <TrackRow
      track={{ ...toTrackSummary(song.track), trackNumber }}
      state={playing ? "playing" : undefined}
      favorite={favorites.has(song.track.id)}
      leading={trackNumber === undefined ? "artwork" : "number"}
      downloaded
      {...selectableRow(listedTrackItem(song), selection, onPress,
        (options) => openTrackActions(song.track, options))}
    />
  );
}

/** Song shelves show this many rows per column, the next column peeking in. */
const ROWS_PER_COLUMN = 4;

/** How much of the next column shows at the right edge, so the shelf reads as scrollable. */
const PEEK = CELL * 4;

const columnsOf = <A,>(items: readonly A[], size: number): A[][] => {
  const columns: A[][] = [];
  for (let start = 0; start < items.length; start += size)
    columns.push(items.slice(start, start + size));
  return columns;
};

/** A shelf of songs ("Quick picks"): columns of rows that scroll sideways, edge to edge. */
function SongColumns({ shelf, context, selection }: { shelf: Shelf; context: QueueContext; selection: ListSelection<TrackItem> }) {
  const scrollable = useListScrollable();
  const { width } = useWindowDimensions();
  const indexed = shelf.items.map((item, index) => ({ item, index }));
  const columns = columnsOf(indexed, ROWS_PER_COLUMN);
  const columnWidth =
    columns.length === 1 ? width - grid.margin * 2 : width - grid.margin * 2 - PEEK;
  return (
    <ScrollView
      scrollEnabled={scrollable}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -grid.margin }}
      contentContainerStyle={{ paddingHorizontal: grid.margin, gap: grid.gutter }}
    >
      {columns.map((column) => (
        <View key={column[0]?.index} style={{ width: columnWidth }}>
          {column.map(({ item, index }) =>
            item.kind === "song" ? (
              <DiscoverSongRow
                key={index}
                song={item.song}
                selection={selection}
                onPress={() => runDiscoverAction(discoverItemAction(shelf, index), context)}
              />
            ) : null,
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const artworkOf = (item: Item): string | null =>
  item.kind === "song" ? item.song.song.artworkUrl : item.artworkUrl;

const titleOf = (item: Item): string => (item.kind === "song" ? item.song.song.title : item.title);

/** A shelf of covers (mixes, albums, playlists): a row that scrolls sideways, edge to edge. */
function TileShelf({ shelf, context, selection }: { shelf: Shelf; context: QueueContext; selection: ListSelection<TrackItem> }) {
  return (
    <CoverRow>
      {shelf.items.map((item, index) => {
        const caption = discoverTileCaption(item);
        const artworkUrl = artworkOf(item);
        const open = () => runDiscoverAction(discoverItemAction(shelf, index), context, {
          line: caption.line, artworkUrl,
        });
        const row = item.kind === "song"
          ? selectableRow(listedTrackItem(item.song), selection, open,
              (options) => item.song.source === "library"
                ? openTrackActions(item.song.track, options)
                : openYtSongActions(item.song.song, options))
          : {
              onPress: () => { if (!selection.selecting) open(); },
              onLongPress: () => {
                if (!selection.selecting && item.kind === "album") openYtAlbumActions({
                  browseId: item.browseId, title: item.title, line: caption.line, artworkUrl,
                });
              },
            };
        return (
          <AlbumTile
            key={index}
            album={{
              id: String(index),
              title: titleOf(item),
              albumArtist: caption.line,
              trackCount: 0,
              durationMs: 0,
              artworkUri: artworkUrl ?? undefined,
            }}
            size={COVER_ROW_TILE}
            detail={caption.detail}
            {...row}
          />
        );
      })}
    </CoverRow>
  );
}

/** Discover's shelves, each under its catalog line: song rows or covers (Core's layout). */
export function DiscoverShelves({ shelves }: { shelves: readonly Shelf[] }) {
  const selectable = useMemo(() => shelves.flatMap((shelf) => shelf.items.flatMap((item) =>
    item.kind === "song" ? [listedTrackItem(item.song)] : [])), [shelves]);
  const selection = useListSelection({ items: selectable, keyOf: trackItemKey, target: tracksTarget });
  return (
    <>
      {shelves.map((shelf, index) => {
        const context = { kind: "discover", id: shelf.title } as const;
        return (
          <TitledSection key={`${index}-${shelf.title}`} title={shelf.title} first={index === 0}>
            {shelf.layout === "songs" ? (
              <SongColumns shelf={shelf} context={context} selection={selection} />
            ) : (
              <TileShelf shelf={shelf} context={context} selection={selection} />
            )}
          </TitledSection>
        );
      })}
    </>
  );
}
