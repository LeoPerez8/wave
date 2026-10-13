import { LegendList } from "@legendapp/list/react-native";
import {
  counted,
  type QueueContext,
  type SearchKind,
  ytDownloadLine,
  ytDownloadProgress,
  ytSongCredit,
  ytTrackId,
} from "@wave/core";
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
import { playSongs, playYtSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import {
  openAlbumActions,
  openArtistActions,
  openGenreActions,
  openPlaylistActions,
  openTrackActions,
} from "@/playback/ActionsMenu";

import { ArtworkRow } from "./ArtworkRow";
import type { ResultRow } from "./rows";
import type { SearchHit } from "./searchIndex";
import { useListScrollable } from "@/motion/heldTouch";
import { selectableRow } from "@/selection/selectableRow";
import type { ListSelection } from "@/selection/useListSelection";
import { useYtDownloadStatus } from "@/ytmusic/YtDownloads";
import { openYtSongActions } from "@/ytmusic/YtSongActions";

/** Tapping a song plays the song results from it. */
const SEARCH_CONTEXT: QueueContext = { kind: "search", id: null };

const HEIGHT: Readonly<Record<ResultRow["type"], number>> = {
  heading: CELL * 6,
  hit: grid.row,
  more: CELL * 6,
  capped: CELL * 6,
  ytSong: grid.row,
  note: CELL * 6,
};

/** While selecting, results other than Library songs do nothing. */
const ignore = (): void => undefined;

/**
 * A song YT Music found: a Songs-list row with YouTube's cover, its artists
 * and album. Tapping streams the section's songs from it; its long-press menu
 * queues or downloads it. While it downloads, the second line says how far
 * along it is, over a progress rule. While Library songs are being selected,
 * it does nothing.
 */
function YtSongRow({
  song,
  songs,
  playing,
  onOpen,
  selecting,
}: {
  song: NativeYtSong;
  songs: readonly NativeYtSong[];
  playing: boolean;
  onOpen: () => void;
  selecting: boolean;
}) {
  const download = useYtDownloadStatus(song.videoId);
  return (
    <TrackRow
      track={{
        id: ytTrackId(song.videoId),
        title: song.title,
        artist: ytDownloadLine(download) ?? ytSongCredit(song),
        durationMs: song.durationMs,
        artworkUri: song.artworkUrl ?? undefined,
      }}
      state={playing ? "playing" : undefined}
      leading="artwork"
      progress={ytDownloadProgress(download)}
      onPress={
        selecting
          ? ignore
          : () => {
              onOpen();
              void playYtSongs(songs, Math.max(0, songs.indexOf(song)), SEARCH_CONTEXT);
            }
      }
      onLongPress={selecting ? ignore : () => openYtSongActions(song)}
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
  /** Song results are selectable; other results ignore taps while selecting. */
  selection: ListSelection<SongRow>;
};

function Hit({
  hit,
  top,
  songs,
  playing,
  onOpen,
  selection,
}: {
  hit: SearchHit;
  top: boolean;
  songs: readonly SongRow[];
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
          {...selectableRow(
            hit.song,
            selection,
            open(() => playSongs(songs, Math.max(0, songs.indexOf(hit.song)), SEARCH_CONTEXT)),
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
export function SearchResultsList({ rows, onOpen, onShowAll, selection }: Props) {
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
            <YtSongRow
              song={item.song}
              songs={item.songs}
              playing={ytTrackId(item.song.videoId) === currentId}
              onOpen={onOpen}
              selecting={selection.selecting}
            />
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
    [currentId, onOpen, onShowAll, selection],
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
