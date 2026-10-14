import { LegendList } from "@legendapp/list/react-native";
import { ytTrackId, type MixedSong, type YtArtistAlbum, type YtSong } from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { AlbumTile } from "@/catalog/AlbumTile";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { playPage } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openAlbumActions, openTrackActions } from "@/playback/ActionsMenu";
import { mixedTarget, type MixedItem } from "@/playback/actionTargets";
import { albumRowHeight, toAlbumSummary, useAlbumTileSize } from "@/library/AlbumGrid";
import { DetailFrame } from "@/library/DetailFrame";
import { useFavoriteIds } from "@/library/favorites";
import { useArtist } from "@/library/hooks";
import type { AlbumRow, ArtistDetail, ArtistRow, SongRow } from "@/library/LibraryStore";
import { openAlbum, parseId, useKnownRow, useOpenedIntegrated } from "@/library/routes";
import { SongSortButton } from "@/library/SongSortButton";
import { useSortedSongs } from "@/library/songSort";
import { ListIntro, songCount, toTrackSummary } from "@/library/TrackList";
import { useListScrollable } from "@/motion/heldTouch";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";
import { ArtistStatsBlock } from "@/stats/ArtistStatsBlock";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useYtArtistSection } from "@/ytmusic/artistSection";
import { YT_ARTIST_NOTE, YtReleaseTile } from "@/ytmusic/YtArtistSection";
import { YtLookupFooter } from "@/ytmusic/YtLookupFooter";
import { YtSongRow } from "@/ytmusic/YtSongRow";

/** A tile of the page's album grid: a Library album, or a release only YouTube Music has. */
type AlbumCell =
  | { readonly kind: "library"; readonly album: AlbumRow }
  | { readonly kind: "yt"; readonly album: YtArtistAlbum; readonly shelf: "albums" | "singles" };

type Item =
  | { readonly type: "section"; readonly label: string }
  | { readonly type: "albums"; readonly cells: readonly AlbumCell[] }
  | { readonly type: "track"; readonly song: SongRow; readonly index: number }
  | { readonly type: "ytSong"; readonly song: NativeYtSong; readonly index: number };

const SECTION_HEAD = CELL * 6;

/** What YouTube Music adds to the page once asked: releases and top songs the Library lacks. */
interface YtAdditions {
  readonly albums: readonly YtArtistAlbum[];
  readonly singles: readonly YtArtistAlbum[];
  readonly songs: readonly NativeYtSong[];
}

const NO_ADDITIONS: YtAdditions = { albums: [], singles: [], songs: [] };

const libraryCell = (album: AlbumRow): AlbumCell => ({ kind: "library", album });

const cellKey = (cell: AlbumCell): string =>
  cell.kind === "library" ? `album-${cell.album.id}` : `yt-${cell.album.browseId}`;

const artistItems = (detail: ArtistDetail, songs: readonly SongRow[], yt: YtAdditions): Item[] => {
  const items: Item[] = [];
  const shelf = (label: string, cells: readonly AlbumCell[]) => {
    if (cells.length === 0) return;
    items.push({ type: "section", label });
    for (let i = 0; i < cells.length; i += 2)
      items.push({ type: "albums", cells: cells.slice(i, i + 2) });
  };
  // YouTube Music's releases the Library lacks follow the Library's own, in one grid.
  shelf("Albums", [
    ...detail.albums.map(libraryCell),
    ...yt.albums.map((album): AlbumCell => ({ kind: "yt", album, shelf: "albums" })),
  ]);
  shelf(
    "Singles & EPs",
    yt.singles.map((album): AlbumCell => ({ kind: "yt", album, shelf: "singles" })),
  );
  shelf("Appears on", detail.appearsOn.map(libraryCell));
  if (songs.length + yt.songs.length > 0) items.push({ type: "section", label: "Songs" });
  songs.forEach((song, index) => items.push({ type: "track", song, index }));
  yt.songs.forEach((song, index) =>
    items.push({ type: "ytSong", song, index: songs.length + index }),
  );
  return items;
};

const itemKey = (item: Item): string => {
  switch (item.type) {
    case "section":
      return `section-${item.label}`;
    case "albums":
      return `albums-${item.cells.map(cellKey).join("-")}`;
    case "track":
      return `track-${item.song.id}`;
    case "ytSong":
      return ytTrackId(item.song.videoId);
  }
};

const albumItem = (album: AlbumRow): MixedItem => ({ kind: "album", item: album });
const trackItem = (song: SongRow): MixedItem => ({ kind: "track", item: { song } });

/**
 * What can be checked on the page, in page order: the albums (their shelf,
 * then Appears on), then the songs. Albums and songs check together.
 */
const selectableItems = (detail: ArtistDetail, songs: readonly SongRow[]): MixedItem[] => [
  ...detail.albums.map(albumItem),
  ...detail.appearsOn.map(albumItem),
  ...songs.map(trackItem),
];

const selectableKey = (mixed: MixedItem): string =>
  mixed.kind === "album" ? `album-${mixed.item.id}` : `track-${mixed.item.song.id}`;

/** The page's selection as the album tiles see it. */
const albumSelectionOf = (page: ListSelection<MixedItem>): ListSelection<AlbumRow> => ({
  selecting: page.selecting,
  selection: page.selection,
  isChecked: (album) => page.isChecked(albumItem(album)),
  start: (album) => page.start(albumItem(album)),
  toggle: (album) => page.toggle(albumItem(album)),
});

/**
 * A row of the album grid: Library albums (tap opens, long-press the menu,
 * selectable) and YouTube Music's releases the Library lacks.
 */
function AlbumCellPair({
  cells,
  size,
  selection,
  integrated,
}: {
  cells: readonly AlbumCell[];
  size: number;
  selection: ListSelection<AlbumRow>;
  /** Whether the page is an integrated view: the albums open integrated. */
  integrated: boolean;
}) {
  return (
    <View className="flex-row" style={{ gap: grid.gutter, height: albumRowHeight(size) }}>
      {cells.map((cell) =>
        cell.kind === "library" ? (
          <AlbumTile
            key={cellKey(cell)}
            album={toAlbumSummary(cell.album)}
            size={size}
            {...selectableRow(
              cell.album,
              selection,
              () => openAlbum(cell.album.id, cell.album, { integrated }),
              (options) => openAlbumActions(cell.album, options),
            )}
          />
        ) : (
          <YtReleaseTile
            key={cellKey(cell)}
            album={cell.album}
            kind={cell.shelf}
            size={size}
            selecting={selection.selecting}
          />
        ),
      )}
    </View>
  );
}

const ignore = (): void => undefined;

/** The artist page's head: their image as a large circle, then their name. */
function ArtistHead({ artist }: { artist: ArtistRow }) {
  const { width } = useWindowDimensions();
  // Three fifths of the content width, on the cell grid.
  const size = Math.floor(((width - grid.margin * 2) * 0.6) / CELL) * CELL;
  return (
    <View className="items-center" style={{ gap: CELL * 2, paddingBottom: CELL * 2 }}>
      <ArtistImage artist={artist} size={size} large />
      <Text
        accessibilityRole="header"
        numberOfLines={2}
        className="text-center font-sans text-title1 font-light text-foreground"
        style={{ letterSpacing: -0.4 }}
      >
        {artist.name}
      </Text>
    </View>
  );
}

const albumsLine = (count: number): string => `${count} ${count === 1 ? "album" : "albums"}`;

/** What the screen shows: the artist, and their page once it is read. */
interface Shown {
  readonly artist: ArtistRow;
  /** Undefined until the page is read; the head doesn't wait for it. */
  readonly detail: ArtistDetail | undefined;
}

/** The page before it's read: the artist alone, no albums or songs yet. */
const unread = (artist: ArtistRow): ArtistDetail => ({
  artist,
  albums: [],
  appearsOn: [],
  songs: [],
});

function ArtistContent({ shown, openedIntegrated }: { shown: Shown; openedIntegrated: boolean }) {
  const loaded = shown.detail !== undefined;
  const detail = useMemo(() => shown.detail ?? unread(shown.artist), [shown.detail, shown.artist]);
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const tile = useAlbumTileSize(grid.margin);
  // In the sort chosen for artists; Play, Shuffle and rows all play this displayed order.
  const { songs } = useSortedSongs("artist", detail.songs);
  // The releases among these the Library has aren't YouTube Music's to add.
  const libraryAlbums = useMemo(
    () => [...detail.albums, ...detail.appearsOn],
    [detail.albums, detail.appearsOn],
  );
  // Asked on Show on YouTube Music, or on its own when opened integrated (from a streamed
  // song's artist); nothing shows until the page is read.
  const yt = useYtArtistSection(
    detail.artist.name,
    detail.artist.id,
    libraryAlbums,
    openedIntegrated,
  );
  const ytView = loaded ? yt.view : null;
  const ytShelves = loaded ? yt.shelves : null;
  const integrated = loaded && yt.integrated;
  const additions = useMemo((): YtAdditions => {
    if (ytView === null || ytShelves === null) return NO_ADDITIONS;
    const missing = (kind: "albums" | "singles") =>
      ytShelves
        .find((shelf) => shelf.kind === kind)
        ?.releases.filter((release) => release.library === null)
        .map((release) => release.album) ?? [];
    return { albums: missing("albums"), singles: missing("singles"), songs: ytView.songs };
  }, [ytView, ytShelves]);
  // The page's songs in page order: the Library's, then the top songs YouTube Music adds.
  const mixed = useMemo(
    (): MixedSong<YtSong, SongRow>[] => [
      ...songs.map((track) => ({ source: "library" as const, track })),
      ...additions.songs.map((song) => ({ source: "stream" as const, song })),
    ],
    [songs, additions.songs],
  );
  // Play, Shuffle and rows play this list by one rule (`playPage`): with YouTube Music's songs
  // on the page (an integrated view) the mixed list, the Library's files and the top songs
  // streamed, and the Library's rows are marked downloaded; otherwise the Library's songs alone.
  const downloaded = additions.songs.length > 0;
  const items = useMemo(() => artistItems(detail, songs, additions), [detail, songs, additions]);
  // Albums and songs select together; the bar acts on them in page order.
  const selectable = useMemo(() => selectableItems(detail, songs), [detail, songs]);
  const page = useListSelection({ items: selectable, keyOf: selectableKey, target: mixedTarget });
  const albumSelection = useMemo(() => albumSelectionOf(page), [page]);
  const { selection } = page;
  const rowState = useMemo(
    () => ({ currentId, favorites, tile, selection, downloaded, integrated }),
    [currentId, favorites, tile, selection, downloaded, integrated],
  );
  const context = useMemo(
    () => ({ kind: "artist", id: String(detail.artist.id) }) as const,
    [detail.artist.id],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.type) {
        case "section":
          return (
            <View className="justify-end" style={{ height: SECTION_HEAD, paddingBottom: CELL }}>
              <CatalogLine>{item.label}</CatalogLine>
            </View>
          );
        case "albums":
          return (
            <AlbumCellPair
              cells={item.cells}
              size={tile}
              selection={albumSelection}
              integrated={integrated}
            />
          );
        case "track":
          return (
            <TrackRow
              track={toTrackSummary(item.song)}
              state={String(item.song.id) === currentId ? "playing" : undefined}
              favorite={favorites.has(item.song.id)}
              leading="artwork"
              downloaded={downloaded}
              {...selectableRow(
                trackItem(item.song),
                page,
                () => void playPage(mixed, item.index, context),
                (options) => openTrackActions(item.song, options),
              )}
            />
          );
        case "ytSong":
          return (
            <YtSongRow
              song={item.song}
              playing={ytTrackId(item.song.videoId) === currentId}
              onPress={page.selecting ? ignore : () => void playPage(mixed, item.index, context)}
              onLongPress={page.selecting ? ignore : undefined}
            />
          );
      }
    },
    [context, currentId, favorites, mixed, downloaded, tile, albumSelection, page, integrated],
  );

  const line = [
    detail.artist.albumCount > 0 ? albumsLine(detail.artist.albumCount) : null,
    songCount(loaded ? songs.length : detail.artist.trackCount),
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <LegendList
      scrollEnabled={scrollable}
      className="flex-1"
      data={items}
      keyExtractor={itemKey}
      renderItem={renderItem}
      extraData={rowState}
      getItemType={(item) => item.type}
      getFixedItemSize={(item) =>
        item.type === "section"
          ? SECTION_HEAD
          : item.type === "albums"
            ? albumRowHeight(tile)
            : grid.row
      }
      estimatedItemSize={grid.row}
      recycleItems
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      ListHeaderComponent={
        <>
          <ArtistHead artist={detail.artist} />
          <ListIntro
            line={line}
            songs={loaded ? songs : undefined}
            mixed={loaded ? mixed : undefined}
            context={context}
            sortControl={<SongSortButton kind="artist" />}
          />
          {loaded && <ArtistStatsBlock artistId={detail.artist.id} songs={detail.songs} />}
        </>
      }
      ListFooterComponent={
        ytView === null ? null : (
          <YtLookupFooter
            note={ytView.note === null ? null : YT_ARTIST_NOTE[ytView.note]}
            button={ytView.button}
            onShow={yt.show}
          />
        )
      }
    />
  );
}

/**
 * An artist: their albums, the albums they appear on, their songs and, while
 * YT Music is on, Show on YouTube Music (asked only on a tap): then the
 * releases and top songs YouTube Music has that the Library lacks join the
 * albums and songs, the Library's songs are marked downloaded, and Play,
 * Shuffle and taps play the mixed list. Opened integrated (`openArtist`'s
 * `integrated`, from a streamed song's artist), it asks on its own, with no
 * tap. Opened from a list that knows the artist, the head is there on the
 * first frame and the rest follows once read.
 */
export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const artistId = parseId(id);
  const detail = useArtist(artistId);
  const known = useKnownRow("artist", artistId);
  const openedIntegrated = useOpenedIntegrated();
  const shown: Shown | null | undefined =
    detail === undefined
      ? known === undefined
        ? undefined
        : { artist: known, detail: undefined }
      : detail === null
        ? null
        : { artist: detail.artist, detail };
  return (
    <DetailFrame detail={shown} noun="artist">
      {(artist) => <ArtistContent shown={artist} openedIntegrated={openedIntegrated} />}
    </DetailFrame>
  );
}
