import { useLocalisation } from "@/localisation/localisation";
import {
  formatNumber,
  joinArtists,
  type QueueContext,
  type SearchKind,
  type YtArtistAlbum,
} from "@wave/core";
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";

import { artworkUri } from "@/catalog/artworkUri";
import { AlbumCardRow } from "@/catalog/cards/AlbumCard";
import { ArtistCardRow } from "@/catalog/cards/ArtistCard";
import { PlaylistCardRow } from "@/catalog/cards/PlaylistCard";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { NameRow } from "@/catalog/NameRow";
import { SKELETON_ROWS, TrackSkeletons } from "@/catalog/Skeletons";
import { useChromeInset } from "@/chrome/chrome";
import { TextButton } from "@/components/TextButton";
import { listedTrackItem, type TrackItem } from "@/playback/actionTargets";
import { openAlbum, openArtist, openGenre, openPlaylist } from "@/library/routes";
import { playPage } from "@/playback/actions";
import {
  openAlbumActions,
  openArtistActions,
  openGenreActions,
  openPlaylistActions,
} from "@/playback/ActionsMenu";

import type { ResultRow, ResultSong } from "./rows";
import type { SearchHit } from "./searchIndex";
import { useListScrollable } from "@/motion/heldTouch";
import type { ListSelection } from "@/selection/useListSelection";
import { openYtAlbum, openYtArtist } from "@/ytmusic/routes";
import { openYtAlbumActions } from "@/ytmusic/YtAlbumActions";
import { openYtArtistActions } from "@/ytmusic/YtArtistActions";
import {
  mixedSongEntry,
  openMixedSongActions,
  runMixedSongSwipe,
  songSelection,
} from "@/songs/mixedSongs";
import { SongList } from "@/songs/SongList";
import type { SongListEntry } from "@/songs/songListSources";

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

/** A song result as a song card's row: its play disc, "Song · " before its artist. */
const SONG_CARD = { leading: { kind: "playDisc" }, kindLine: true } as const;

/** The song a result row is, if it is one: what it plays, swipes and checks as. */
const songOf = (row: ResultRow): ResultSong | null =>
  row.type === "hit" && row.hit.kind === "song"
    ? { source: "library", track: row.hit.song }
    : row.type === "ytSong"
      ? { source: "stream", song: row.song }
      : null;

const songEntry = (row: ResultRow): SongListEntry | null => {
  const song = songOf(row);
  return song === null ? null : mixedSongEntry(song, SONG_CARD);
};

const songItem = (row: ResultRow): TrackItem | null => {
  const song = songOf(row);
  return song === null ? null : listedTrackItem(song);
};

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

/** A result that isn't a song: a card or name row, which ignores taps while selecting. */
function Hit({
  hit,
  top,
  integrated,
  onOpen,
  selection,
}: {
  hit: Exclude<SearchHit, { readonly kind: "song" }>;
  /** The top result says what type it is (genres, which have no card). */
  top: boolean;
  /** An album opens integrated. */
  integrated: boolean;
  onOpen: () => void;
  selection: ListSelection<TrackItem>;
}) {
  const { strings } = useLocalisation();
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
        <ArtistCardRow
          name={hit.name}
          artist={hit.artist}
          onPress={open(() => openArtist(hit.artist.id, hit.artist))}
          onLongPress={menu(() => openArtistActions(hit.artist))}
        />
      );
    case "album":
      return (
        <AlbumCardRow
          title={hit.name}
          artist={hit.album.albumArtist}
          artworkUri={artworkUri(hit.album)}
          onPress={open(() => openAlbum(hit.album.id, hit.album, { integrated }))}
          onLongPress={menu(() => openAlbumActions(hit.album))}
        />
      );
    case "playlist":
      return (
        <PlaylistCardRow
          name={hit.name}
          detail={strings.playbackText.songCount(hit.playlist.trackCount)}
          paths={hit.playlist.thumbPaths}
          onPress={open(() => openPlaylist(hit.playlist.id, hit.playlist))}
          onLongPress={menu(() => openPlaylistActions(hit.playlist))}
        />
      );
    case "genre":
      return (
        <NameRow
          name={hit.name}
          detail={`${top ? strings.playbackText.genre : ""}${strings.playbackText.songCount(hit.genre.trackCount)}`}
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
  const { strings } = useLocalisation();
  const { language } = useLocalisation();
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const rowSelection = useMemo(() => songSelection(selection, songItem), [selection]);
  const rowState = useMemo(
    () => ({ selection: selection.selection, integrated, language }),
    [selection.selection, integrated, language],
  );

  const renderSlot = useCallback(
    ({ item }: { item: ResultRow }) => {
      switch (item.type) {
        case "heading":
          return (
            <View className="justify-end" style={{ height: HEIGHT.heading, paddingBottom: CELL }}>
              <CatalogLine>{item.label}</CatalogLine>
            </View>
          );
        case "hit":
          return item.hit.kind === "song" ? null : (
            <Hit
              hit={item.hit}
              top={item.top}
              integrated={integrated}
              onOpen={onOpen}
              selection={selection}
            />
          );
        case "more":
          return (
            <View style={{ height: HEIGHT.more }}>
              <TextButton
                label={strings.playbackText.showAllValue(formatNumber(language, item.total))}
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
                {strings.playbackText.theBestValueOfValueKeepTypingToNarrowThemDown(
                  formatNumber(language, item.shown),
                  formatNumber(language, item.total),
                )}
              </Text>
            </View>
          );
        case "ytSong":
          return null;
        case "ytArtist": {
          const { artist } = item;
          return (
            <ArtistCardRow
              name={artist.name}
              artist={{
                name: artist.name,
                thumbPath: null,
                artworkPath: null,
                imageUrl: artist.artworkUrl,
              }}
              detail={strings.playbackText.artistYouTubeMusic}
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
            <AlbumCardRow
              title={head.title}
              artist={head.line}
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
          return (
            <TrackSkeletons label={strings.playbackText.loadingOnlineResults} leading="card" />
          );
      }
    },
    [onOpen, onShowAll, integrated, selection, language, strings],
  );

  return (
    <View className="flex-1">
      <SongList
        scrollEnabled={scrollable}
        className="flex-1"
        data={rows}
        keyExtractor={keyExtractor}
        song={songEntry}
        context={SEARCH_CONTEXT}
        renderSlot={renderSlot}
        slotType={itemType}
        slotSize={itemSize}
        extraData={rowState}
        selection={rowSelection}
        onPlay={(row) => {
          const song = songOf(row);
          if (song === null) return;
          onOpen();
          if (row.type === "ytSong") playResults(row.songs, row.index);
          else if (row.type === "hit" && row.hit.kind === "song") {
            const track = row.hit.song;
            playResults(
              row.songs,
              Math.max(
                0,
                row.songs.findIndex((entry) => entry.source === "library" && entry.track === track),
              ),
            );
          }
        }}
        onMenu={(row, options) => {
          const song = songOf(row);
          if (song !== null) openMixedSongActions(song, options);
        }}
        onSongSwipe={(row, side) => {
          const song = songOf(row);
          if (song !== null) runMixedSongSwipe(song, side);
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      />
    </View>
  );
}
