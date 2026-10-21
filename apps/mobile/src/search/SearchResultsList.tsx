import { LegendList } from "@legendapp/list/react-native";
import {
  counted,
  joinArtists,
  type QueueContext,
  type SearchKind,
  type YtArtistAlbum,
  ytTrackId,
} from "@wave/core";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { NameRow } from "@/catalog/NameRow";
import { SKELETON_ROWS, TrackSkeletons } from "@/catalog/Skeletons";
import { SwipeTrackRow } from "@/library/SwipeTrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { TextButton } from "@/components/TextButton";
import type { TrackItem } from "@/playback/actionTargets";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openAlbum, openArtist, openGenre, openPlaylist } from "@/library/routes";
import { toTrackSummary } from "@/library/TrackList";
import { playPage } from "@/playback/actions";
import { useCurrentPlayingIds } from "@/playback/hooks";
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
import { openYtAlbum, openYtArtist } from "@/ytmusic/routes";
import { openYtAlbumActions } from "@/ytmusic/YtAlbumActions";
import { openYtArtistActions } from "@/ytmusic/YtArtistActions";
import { SwipeYtSongRow } from "@/ytmusic/YtSongRow";
import { openYtSongActions } from "@/ytmusic/YtSongActions";

/** Tapping a song plays the song results from it. */
const SEARCH_CONTEXT: QueueContext = { kind: "search", id: null };

const HEIGHT: Readonly<Record<ResultRow["type"], number>> = {
  heading: CELL * 6,
  hit: grid.row,
  more: CELL * 6,
  capped: CELL * 6,
  ytSong: grid.row,
  ytArtist: grid.row,
  ytAlbum: grid.row,
  note: CELL * 6,
  skeleton: grid.row * SKELETON_ROWS,
};

/** Non-song results stay in place while selecting. */
const ignore = (): void => undefined;

/**
 * Plays the song results from [index] (`playPage`): the Library's files and,
 * when YT Music found songs the Library lacks, those streamed after them.
 */
const playResults = (songs: readonly ResultSong[], index: number): void =>
  void playPage(songs, index, SEARCH_CONTEXT);

/**
 * A song YT Music found, among the song results. Tapping plays the results
 * from it, or checks it while selecting.
 */
function SearchYtSongRow({
  song,
  songs,
  index,
  top,
  playing,
  onOpen,
  selection,
}: {
  song: NativeYtSong;
  songs: readonly ResultSong[];
  index: number;
  top: boolean;
  playing: boolean;
  onOpen: () => void;
  selection: ListSelection<TrackItem>;
}) {
  return (
    <SwipeYtSongRow
      song={song}
      kind={top ? "Song · " : ""}
      playing={playing}
      {...selectableRow(
        { ytSong: song },
        selection,
        () => {
          onOpen();
          playResults(songs, index);
        },
        (options) => openYtSongActions(song, options),
      )}
    />
  );
}

/** What a YT Music album's page and menu know of it from its row. */
const ytAlbumHead = (album: YtArtistAlbum) => ({
  browseId: album.browseId,
  title: album.title,
  line: joinArtists(album.artists),
  artworkUrl: album.artworkUrl,
});

const keyExtractor = (row: ResultRow): string => row.key;
const itemType = (row: ResultRow): ResultRow["type"] => row.type;
const itemSize = (row: ResultRow): number | undefined =>
  row.type === "note" || row.type === "capped" ? undefined : HEIGHT[row.type];

type Props = {
  rows: readonly ResultRow[];
  /** Called when a result opens, so the search is kept among the recent ones. */
  onOpen: () => void;
  onShowAll: (kind: SearchKind) => void;
  /** Search shows YouTube Music's results (an integrated view): Library albums open integrated. */
  integrated: boolean;
  /** Song results are selectable; other results ignore taps while selecting. */
  selection: ListSelection<TrackItem>;
};

function Hit({
  hit,
  top,
  songs,
  downloaded,
  artistSongs,
  integrated,
  playing,
  onOpen,
  selection,
}: {
  hit: SearchHit;
  top: boolean;
  songs: readonly ResultSong[];
  /** A song among YT Music's: marked downloaded. */
  downloaded: boolean;
  /** An artist's song count with what Online adds; null: the Library's. */
  artistSongs: number | null;
  /** An album opens integrated. */
  integrated: boolean;
  playing: boolean;
  onOpen: () => void;
  selection: ListSelection<TrackItem>;
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
          detail={top ? "Artist" : counted(artistSongs ?? hit.artist.trackCount, "song")}
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
          onPress={open(() => openAlbum(hit.album.id, hit.album, { integrated }))}
          onLongPress={menu(() => openAlbumActions(hit.album))}
        />
      );
    case "song": {
      const track = toTrackSummary(hit.song);
      return (
        <SwipeTrackRow
          song={hit.song}
          track={top ? { ...track, artist: `Song · ${track.artist}` } : track}
          state={playing ? "playing" : undefined}
          leading="artwork"
          downloaded={downloaded}
          {...selectableRow(
            { song: hit.song },
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
export function SearchResultsList({ rows, onOpen, onShowAll, integrated, selection }: Props) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const currentIds = useCurrentPlayingIds();
  const rowState = useMemo(
    () => ({ currentIds, selection: selection.selection, integrated }),
    [currentIds, selection.selection, integrated],
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
              artistSongs={item.artistSongs}
              integrated={integrated}
              playing={item.hit.kind === "song" && currentIds.has(String(item.hit.song.id))}
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
            <View
              className="justify-center"
              style={{ minHeight: HEIGHT.capped, paddingVertical: CELL }}
            >
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
              top={item.top}
              playing={currentIds.has(ytTrackId(item.song.videoId))}
              onOpen={onOpen}
              selection={selection}
            />
          );
        case "ytArtist": {
          const { artist } = item;
          return (
            <NameRow
              name={artist.name}
              artist={{
                name: artist.name,
                thumbPath: null,
                artworkPath: null,
                imageUrl: artist.artworkUrl,
              }}
              detail={item.top ? "Artist · YouTube Music" : "YouTube Music"}
              onPress={
                selection.selecting
                  ? ignore
                  : () => {
                      onOpen();
                      openYtArtist(artist.browseId, artist.name);
                    }
              }
              onLongPress={selection.selecting ? ignore : () => openYtArtistActions(artist)}
            />
          );
        }
        case "ytAlbum": {
          const head = ytAlbumHead(item.album);
          return (
            <ArtworkRow
              title={head.title}
              detail={item.top ? `Album · ${head.line}` : head.line}
              artworkUri={head.artworkUrl ?? undefined}
              onPress={
                selection.selecting
                  ? ignore
                  : () => {
                      onOpen();
                      openYtAlbum(head.browseId, head);
                    }
              }
              onLongPress={selection.selecting ? ignore : () => openYtAlbumActions(head)}
            />
          );
        }
        case "note":
          return (
            <View
              className="justify-center"
              style={{ minHeight: HEIGHT.note, paddingVertical: CELL }}
            >
              <Text
                accessibilityLiveRegion="polite"
                className="font-sans text-footnote text-secondary"
              >
                {item.text}
              </Text>
            </View>
          );
        case "skeleton":
          return <TrackSkeletons label="Loading online results" />;
      }
    },
    [currentIds, onOpen, onShowAll, integrated, selection],
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
