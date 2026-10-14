import { LegendList } from "@legendapp/list/react-native";
import { counted, type QueueContext, type SearchKind, ytTrackId } from "@wave/core";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { NameRow } from "@/catalog/NameRow";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { TextButton } from "@/components/TextButton";
import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openAlbum, openArtist, openGenre, openPlaylist } from "@/library/routes";
import { toTrackSummary } from "@/library/TrackList";
import { playDiscoverSongs, playSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import {
  openAlbumActions,
  openArtistActions,
  openGenreActions,
  openPlaylistActions,
  openTrackActions,
} from "@/playback/ActionsMenu";

import { ArtworkRow } from "./ArtworkRow";
import type { ResultRow, ResultSong } from "./rows";
import type { SearchHit } from "./searchIndex";
import { useListScrollable } from "@/motion/heldTouch";
import { selectableRow } from "@/selection/selectableRow";
import type { ListSelection } from "@/selection/useListSelection";
import { YtSongRow } from "@/ytmusic/YtSongRow";

/** Tapping a song plays the song results from it. */
const SEARCH_CONTEXT: QueueContext = { kind: "search", id: null };

const HEIGHT: Readonly<Record<ResultRow["type"], number>> = {
  heading: CELL * 6,
  hit: grid.row,
  more: CELL * 6,
  capped: CELL * 6,
  ytSong: grid.row,
  note: CELL * 6,
  askYt: CELL * 6,
};

/** While selecting, results other than Library songs do nothing. */
const ignore = (): void => undefined;

/**
 * Plays the song results from [index]: the Library's files and, when YT Music
 * found songs the Library lacks, those streamed after them.
 */
const playResults = (songs: readonly ResultSong[], index: number): void => {
  const library = songs.flatMap((song) => (song.source === "library" ? [song.track] : []));
  if (library.length === songs.length) playSongs(library, index, SEARCH_CONTEXT);
  else void playDiscoverSongs(songs, index, SEARCH_CONTEXT);
};

/**
 * A song YT Music found, among the song results. Tapping plays the results
 * from it. While Library songs are being selected, it does nothing.
 */
function SearchYtSongRow({
  song,
  songs,
  index,
  playing,
  onOpen,
  selecting,
}: {
  song: NativeYtSong;
  songs: readonly ResultSong[];
  index: number;
  playing: boolean;
  onOpen: () => void;
  selecting: boolean;
}) {
  return (
    <YtSongRow
      song={song}
      playing={playing}
      onPress={
        selecting
          ? ignore
          : () => {
              onOpen();
              playResults(songs, index);
            }
      }
      onLongPress={selecting ? ignore : undefined}
    />
  );
}

const keyExtractor = (row: ResultRow): string => row.key;
const itemType = (row: ResultRow): ResultRow["type"] => row.type;
const itemSize = (row: ResultRow): number => HEIGHT[row.type];

type Props = {
  rows: readonly ResultRow[];
  /** Called when a result opens, so the search is kept among the recent ones. */
  onOpen: () => void;
  onShowAll: (kind: SearchKind) => void;
  /** Search YouTube Music was tapped. */
  onAskYt: () => void;
  /** Song results are selectable; other results ignore taps while selecting. */
  selection: ListSelection<SongRow>;
};

function Hit({
  hit,
  top,
  songs,
  downloaded,
  playing,
  onOpen,
  selection,
}: {
  hit: SearchHit;
  top: boolean;
  songs: readonly ResultSong[];
  /** A song among YT Music's: marked downloaded. */
  downloaded: boolean;
  playing: boolean;
  onOpen: () => void;
  selection: ListSelection<SongRow>;
}) {
  const { selecting } = selection;
  const open = (action: () => void) =>
    selecting
      ? ignore
      : () => {
          onOpen();
          action();
        };
  const menu = (action: () => void) => (selecting ? ignore : action);
  switch (hit.kind) {
    case "artist":
      return (
        <NameRow
          name={hit.name}
          artist={hit.artist}
          detail={top ? "Artist" : counted(hit.artist.trackCount, "song")}
          onPress={open(() => openArtist(hit.artist.id, hit.artist))}
          onLongPress={menu(() => openArtistActions(hit.artist))}
        />
      );
    case "album":
      return (
        <ArtworkRow
          title={hit.name}
          detail={top ? `Album · ${hit.album.albumArtist}` : hit.album.albumArtist}
          artworkUri={hit.album.thumbPath === null ? undefined : `file://${hit.album.thumbPath}`}
          onPress={open(() => openAlbum(hit.album.id, hit.album))}
          onLongPress={menu(() => openAlbumActions(hit.album))}
        />
      );
    case "song": {
      const track = toTrackSummary(hit.song);
      return (
        <TrackRow
          track={top ? { ...track, artist: `Song · ${track.artist}` } : track}
          state={playing ? "playing" : undefined}
          leading="artwork"
          downloaded={downloaded}
          {...selectableRow(
            hit.song,
            selection,
            open(() =>
              playResults(
                songs,
                Math.max(
                  0,
                  songs.findIndex((song) => song.source === "library" && song.track === hit.song),
                ),
              ),
            ),
            (options) => openTrackActions(hit.song, options),
          )}
        />
      );
    }
    case "playlist":
      return (
        <NameRow
          name={hit.name}
          detail={`${top ? "Playlist · " : ""}${counted(hit.playlist.trackCount, "song")}`}
          onPress={open(() => openPlaylist(hit.playlist.id, hit.playlist))}
          onLongPress={menu(() => openPlaylistActions(hit.playlist))}
        />
      );
    case "genre":
      return (
        <NameRow
          name={hit.name}
          detail={`${top ? "Genre · " : ""}${counted(hit.genre.trackCount, "song")}`}
          onPress={open(() => openGenre(hit.genre.id, hit.genre))}
          onLongPress={menu(() => openGenreActions(hit.genre))}
        />
      );
  }
}

/**
 * Search results in one virtualised list of fixed-height rows: section heads,
 * results and "Show all". Scrolling or tapping a row lets the keyboard go.
 */
export function SearchResultsList({ rows, onOpen, onShowAll, onAskYt, selection }: Props) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const rowState = useMemo(
    () => ({ currentId, selection: selection.selection }),
    [currentId, selection.selection],
  );

  const renderItem = useCallback(
    ({ item }: { item: ResultRow }) => {
      switch (item.type) {
        case "heading":
          return (
            <View className="justify-end" style={{ height: HEIGHT.heading, paddingBottom: CELL }}>
              <CatalogLine>{item.label}</CatalogLine>
            </View>
          );
        case "hit":
          return (
            <Hit
              hit={item.hit}
              top={item.top}
              songs={item.songs}
              downloaded={item.downloaded}
              playing={item.hit.kind === "song" && String(item.hit.song.id) === currentId}
              onOpen={onOpen}
              selection={selection}
            />
          );
        case "more":
          return (
            <View style={{ height: HEIGHT.more }}>
              <TextButton
                label={`Show all ${item.total.toLocaleString("en")}`}
                onPress={() => onShowAll(item.kind)}
              />
            </View>
          );
        case "capped":
          return (
            <View className="justify-center" style={{ height: HEIGHT.capped }}>
              <Text className="font-sans text-footnote text-secondary">
                {`The best ${item.shown.toLocaleString("en")} of ${item.total.toLocaleString("en")}. Keep typing to narrow them down.`}
              </Text>
            </View>
          );
        case "ytSong":
          return (
            <SearchYtSongRow
              song={item.song}
              songs={item.songs}
              index={item.index}
              playing={ytTrackId(item.song.videoId) === currentId}
              onOpen={onOpen}
              selecting={selection.selecting}
            />
          );
        case "askYt":
          return (
            <View style={{ height: HEIGHT.askYt }}>
              <TextButton
                label="Search YouTube Music"
                disabled={selection.selecting}
                onPress={onAskYt}
              />
            </View>
          );
        case "note":
          return (
            <View className="justify-center" style={{ height: HEIGHT.note }}>
              <Text numberOfLines={2} className="font-sans text-footnote text-secondary">
                {item.text}
              </Text>
            </View>
          );
      }
    },
    [currentId, onOpen, onShowAll, onAskYt, selection],
  );

  return (
    <LegendList
      scrollEnabled={scrollable}
      className="flex-1"
      data={rows}
      keyExtractor={keyExtractor}
      getItemType={itemType}
      renderItem={renderItem}
      extraData={rowState}
      estimatedItemSize={grid.row}
      getFixedItemSize={itemSize}
      recycleItems
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
    />
  );
}
