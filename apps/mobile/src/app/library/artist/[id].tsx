import { LegendList } from "@legendapp/list/react-native";
import {
  artistPageItems,
  libraryFinder,
  rankPopular,
  ytTrackId,
  type ArtistPageItem,
  type MixedSong,
  type YtArtistAlbum,
  type YtSong,
} from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { AlbumTile } from "@/catalog/AlbumTile";
import { SECTION_HEAD, SectionHead } from "@/catalog/CatalogLine";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL, grid } from "@/catalog/grid";
import { SKELETON_TILES, SkeletonGroup, TileSkeleton, TrackSkeletons } from "@/catalog/Skeletons";
import { SwipeTrackRow } from "@/library/SwipeTrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { playPage } from "@/playback/actions";
import { useCurrentPlayingIds } from "@/playback/hooks";
import { openAlbumActions, openTrackActions } from "@/playback/ActionsMenu";
import { mixedTarget, trackItemKey, type MixedItem } from "@/playback/actionTargets";
import { albumRowHeight, toAlbumSummary } from "@/library/AlbumGrid";
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
import { useLoadedLibraryFinder, type FindInLibrary } from "@/ytmusic/libraryFinder";
import { useHeldSongs, useSongsInPlace, type PlacedSongs } from "@/ytmusic/songsInPlace";
import { YT_ARTIST_NOTE, YtReleaseTile } from "@/ytmusic/YtArtistSection";
import { YtLookupFooter } from "@/ytmusic/YtLookupFooter";
import { SwipeYtSongRow } from "@/ytmusic/YtSongRow";
import { openYtSongActions } from "@/ytmusic/YtSongActions";

/** A cover on one of the page's album shelves: a Library album, or a release only YouTube Music has. */
type AlbumCell =
  | { readonly kind: "library"; readonly album: AlbumRow }
  | { readonly kind: "yt"; readonly album: YtArtistAlbum; readonly shelf: "albums" | "singles" }
  /** Skeleton tiles where YouTube Music's releases will go, while it's asked. */
  | { readonly kind: "skeleton" };

const SKELETON_CELL: AlbumCell = { kind: "skeleton" };

/** A Library song of the artist, with its place in YouTube Music's list once it's known (Popular). */
type RankedSong = SongRow & { readonly popularRank?: number | undefined };

/** A row of the Songs section: the Library's song, or a song of the artist YouTube Music adds. */
type PageSong =
  | { readonly kind: "library"; readonly song: RankedSong }
  | { readonly kind: "yt"; readonly song: NativeYtSong };

type Item = ArtistPageItem<AlbumCell, PageSong>;

/** Height of an album shelf's row, the gap under it included. */
const SHELF_ROW = albumRowHeight(COVER_ROW_TILE);

/** What YouTube Music adds to the page once asked: the artist's releases and songs the Library lacks. */
interface YtAdditions {
  readonly albums: readonly YtArtistAlbum[];
  readonly singles: readonly YtArtistAlbum[];
  readonly songs: readonly NativeYtSong[];
}

const NO_ADDITIONS: YtAdditions = { albums: [], singles: [], songs: [] };

const libraryCell = (album: AlbumRow): AlbumCell => ({ kind: "library", album });

const cellKey = (cell: AlbumCell): string => {
  switch (cell.kind) {
    case "library":
      return `album-${cell.album.id}`;
    case "yt":
      return `yt-${cell.album.browseId}`;
    case "skeleton":
      return "skeleton";
  }
};

/** A song YouTube Music added: streamed, or the Library's file once its download finished. */
const placedSong = (row: PlacedSongs["songs"][number]): PageSong =>
  row.source === "library" ? { kind: "library", song: row.track } : { kind: "yt", song: row.song };

/**
 * The page's shelves and songs, the songs under [songsLabel]. While YouTube
 * Music is asked ([loading]), skeleton tiles follow the Library's albums where
 * its releases will go.
 */
const artistItems = (
  detail: ArtistDetail,
  songs: readonly PageSong[],
  yt: YtAdditions,
  loading: boolean,
  songsLabel: string,
): Item[] =>
  artistPageItems(
    [
      // YouTube Music's releases the Library lacks follow the Library's own, on one shelf.
      {
        label: "Albums",
        covers: [
          ...detail.albums.map(libraryCell),
          ...yt.albums.map((album): AlbumCell => ({ kind: "yt", album, shelf: "albums" })),
          ...(loading ? [SKELETON_CELL] : []),
        ],
      },
      {
        label: "Singles & EPs",
        covers: yt.singles.map((album): AlbumCell => ({ kind: "yt", album, shelf: "singles" })),
      },
      { label: "Appears on", covers: detail.appearsOn.map(libraryCell) },
    ],
    songs,
    songsLabel,
  );

const itemKey = (item: Item): string => {
  switch (item.type) {
    case "section":
      return `section-${item.label}`;
    case "shelf":
      return `shelf-${item.label}`;
    case "song":
      return item.song.kind === "library"
        ? `track-${item.song.song.id}`
        : ytTrackId(item.song.song.videoId);
  }
};

const albumItem = (album: AlbumRow): MixedItem => ({ kind: "album", item: album });
const trackItem = (song: SongRow): MixedItem => ({ kind: "track", item: { song } });
const ytTrackItem = (ytSong: NativeYtSong): MixedItem => ({ kind: "track", item: { ytSong } });

/**
 * What can be checked on the page, in page order: the albums (their shelf,
 * then Appears on), then the songs. Albums and songs check together.
 */
const selectableItems = (detail: ArtistDetail, songs: readonly PageSong[]): MixedItem[] => [
  ...detail.albums.map(albumItem),
  ...detail.appearsOn.map(albumItem),
  ...songs.map((song) => (song.kind === "library" ? trackItem(song.song) : ytTrackItem(song.song))),
];

const selectableKey = (mixed: MixedItem): string =>
  mixed.kind === "album" ? `album-${mixed.item.id}` : `track-${trackItemKey(mixed.item)}`;

/** The page's selection as the album tiles see it. */
const albumSelectionOf = (page: ListSelection<MixedItem>): ListSelection<AlbumRow> => ({
  selecting: page.selecting,
  selection: page.selection,
  isChecked: (album) => page.isChecked(albumItem(album)),
  start: (album) => page.start(albumItem(album)),
  toggle: (album) => page.toggle(albumItem(album)),
});

/**
 * An album shelf as one row of covers that scrolls sideways: Library albums
 * (tap opens, long-press the menu, selectable) and YouTube Music's releases
 * the Library lacks.
 */
function AlbumShelfRow({
  cells,
  selection,
  integrated,
}: {
  cells: readonly AlbumCell[];
  selection: ListSelection<AlbumRow>;
  /** Whether the page is an integrated view: the albums open integrated. */
  integrated: boolean;
}) {
  return (
    <View style={{ height: SHELF_ROW }}>
      <CoverRow>
        {cells.map((cell) => {
          switch (cell.kind) {
            case "library":
              return (
                <AlbumTile
                  key={cellKey(cell)}
                  album={toAlbumSummary(cell.album)}
                  size={COVER_ROW_TILE}
                  {...selectableRow(
                    cell.album,
                    selection,
                    () => openAlbum(cell.album.id, cell.album, { integrated }),
                    (options) => openAlbumActions(cell.album, options),
                  )}
                />
              );
            case "yt":
              return (
                <YtReleaseTile
                  key={cellKey(cell)}
                  album={cell.album}
                  kind={cell.shelf}
                  size={COVER_ROW_TILE}
                  selecting={selection.selecting}
                />
              );
            case "skeleton":
              return (
                <SkeletonGroup key={cellKey(cell)} label="Loading albums">
                  <View className="flex-row" style={{ gap: grid.gutter }}>
                    {Array.from({ length: SKELETON_TILES }, (_, index) => (
                      <TileSkeleton key={index} size={COVER_ROW_TILE} />
                    ))}
                  </View>
                </SkeletonGroup>
              );
          }
        })}
      </CoverRow>
    </View>
  );
}

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
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  // The releases among these the Library has aren't YouTube Music's to add.
  const libraryAlbums = useMemo(
    () => [...detail.albums, ...detail.appearsOn],
    [detail.albums, detail.appearsOn],
  );
  // The artist's songs YouTube Music added that the page has shown keep their rows this visit.
  const holding = useHeldSongs();
  // Asked once Online is picked on the page's toggle, or on its own when opened integrated
  // (from a streamed song's artist); nothing shows until the page is read.
  const yt = useYtArtistSection(
    detail.artist.name,
    detail.artist.id,
    libraryAlbums,
    openedIntegrated,
    holding.held,
  );
  const ytView = loaded ? yt.view : null;
  const ytShelves = loaded ? yt.shelves : null;
  const integrated = loaded && yt.integrated;
  // The artist's songs in the sort chosen for artists (Popular by default), ranked by YouTube
  // Music's list of them once it's known. Play, Shuffle and rows all play this displayed order.
  const ranked = useMemo(
    (): readonly RankedSong[] =>
      yt.popular === null ? detail.songs : rankPopular(detail.songs, yt.popular),
    [detail.songs, yt.popular],
  );
  const { sort, songs } = useSortedSongs("artist", ranked);
  // Under Popular with the list known: the songs read "Popular" and carry their ranks.
  const byPopularity = sort.key === "popular" && yt.popular !== null;
  const additions = useMemo((): YtAdditions => {
    if (ytView === null || ytShelves === null) return NO_ADDITIONS;
    const missing = (kind: "albums" | "singles") =>
      ytShelves
        .find((shelf) => shelf.kind === kind)
        ?.releases.filter((release) => release.library === null)
        .map((release) => release.album) ?? [];
    return { albums: missing("albums"), singles: missing("singles"), songs: ytView.songs };
  }, [ytView, ytShelves]);
  // A finished download keeps its row, now the Library's file, until the page is opened again,
  // and the Library's songs above leave that file out. The page's own songs are looked in
  // first, so whichever of them and the shared finder follows the download first, it shows once.
  const sharedFind = useLoadedLibraryFinder();
  const find = useMemo((): FindInLibrary | null => {
    if (sharedFind === null) return null;
    const own = libraryFinder(songs);
    return (song) => own(song) ?? sharedFind(song);
  }, [songs, sharedFind]);
  const placed = useSongsInPlace(holding, additions.songs, find);
  const librarySongs = useMemo(
    () => (placed.tracks.size === 0 ? songs : songs.filter((song) => !placed.tracks.has(song.id))),
    [songs, placed.tracks],
  );
  // The page's songs in page order: the Library's, then every song of the artist YouTube Music
  // adds, in its order.
  const mixed = useMemo(
    (): MixedSong<YtSong, SongRow>[] => [
      ...librarySongs.map((track) => ({ source: "library" as const, track })),
      ...placed.songs,
    ],
    [librarySongs, placed.songs],
  );
  const pageSongs = useMemo(
    (): PageSong[] => [
      ...librarySongs.map((song): PageSong => ({ kind: "library", song })),
      ...placed.songs.map(placedSong),
    ],
    [librarySongs, placed.songs],
  );
  // Play, Shuffle and rows play this list by one rule (`playPage`): with YouTube Music's songs
  // on the page (an integrated view) the mixed list, the Library's files and the artist's songs
  // streamed, and the Library's rows are marked downloaded; otherwise the Library's songs alone.
  const downloaded = additions.songs.length > 0;
  // While YouTube Music is asked, skeletons stand where its releases and songs will go.
  const ytLoading = ytView?.note === "loading";
  const items = useMemo(
    () => artistItems(detail, pageSongs, additions, ytLoading, byPopularity ? "Popular" : "Songs"),
    [detail, pageSongs, additions, ytLoading, byPopularity],
  );
  // Albums and songs select together; the bar acts on them in page order.
  const selectable = useMemo(() => selectableItems(detail, pageSongs), [detail, pageSongs]);
  const page = useListSelection({ items: selectable, keyOf: selectableKey, target: mixedTarget });
  const albumSelection = useMemo(() => albumSelectionOf(page), [page]);
  const { selection } = page;
  const rowState = useMemo(
    () => ({ currentIds, favorites, selection, downloaded, integrated }),
    [currentIds, favorites, selection, downloaded, integrated],
  );
  const context = useMemo(
    () => ({ kind: "artist", id: String(detail.artist.id) }) as const,
    [detail.artist.id],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.type) {
        case "section":
          return <SectionHead label={item.label} />;
        case "shelf":
          // Keyed by shelf, so a recycled row doesn't keep another shelf's scroll position.
          return (
            <AlbumShelfRow
              key={item.label}
              cells={item.covers}
              selection={albumSelection}
              integrated={integrated}
            />
          );
        case "song": {
          if (item.song.kind === "yt") {
            const song = item.song.song;
            return (
              <SwipeYtSongRow
                song={song}
                playing={currentIds.has(ytTrackId(song.videoId))}
                {...selectableRow(
                  ytTrackItem(song),
                  page,
                  () => void playPage(mixed, item.index, context),
                  (options) => openYtSongActions(song, options),
                )}
              />
            );
          }
          const song = item.song.song;
          // Under Popular the rank leads the row in place of the artwork, numbered as a ranking
          // is; a song the list doesn't hold leads with nothing.
          return (
            <SwipeTrackRow
              song={song}
              track={
                byPopularity
                  ? { ...toTrackSummary(song), trackNumber: song.popularRank }
                  : toTrackSummary(song)
              }
              state={currentIds.has(String(song.id)) ? "playing" : undefined}
              favorite={favorites.has(song.id)}
              leading={byPopularity ? "number" : "artwork"}
              topNumber={song.popularRank === 1}
              downloaded={downloaded}
              {...selectableRow(
                trackItem(song),
                page,
                () => void playPage(mixed, item.index, context),
                (options) => openTrackActions(song, options),
              )}
            />
          );
        }
      }
    },
    [
      context,
      currentIds,
      favorites,
      mixed,
      downloaded,
      albumSelection,
      page,
      integrated,
      byPopularity,
    ],
  );

  // With Online and an answer found, the counts take in what YouTube Music adds to the page.
  const local = {
    albums: detail.artist.albumCount,
    songs: loaded ? songs.length : detail.artist.trackCount,
  };
  const counts = loaded ? yt.counts(local) : local;
  const line = [counts.albums > 0 ? albumsLine(counts.albums) : null, songCount(counts.songs)]
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
      getItemType={(item) => (item.type === "song" ? `${item.song.kind}-song` : item.type)}
      getFixedItemSize={(item) =>
        item.type === "section" ? SECTION_HEAD : item.type === "shelf" ? SHELF_ROW : grid.row
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
            toggle={loaded ? yt.toggle : null}
          />
          {loaded && <ArtistStatsBlock artistId={detail.artist.id} songs={detail.songs} />}
        </>
      }
      ListFooterComponent={
        ytView === null ? null : ytView.note === "loading" ? (
          <TrackSkeletons />
        ) : (
          <YtLookupFooter note={ytView.note === null ? null : YT_ARTIST_NOTE[ytView.note]} />
        )
      }
    />
  );
}

/**
 * An artist: their albums, the albums they appear on (each shelf one row of
 * covers that scrolls sideways), their songs and, while YT Music is on, a
 * Library | Online toggle after Play and Shuffle (asked only once Online is
 * picked): then the releases and every song YouTube Music has of theirs that
 * the Library lacks join the albums and songs, the Library's songs are marked
 * downloaded, and Play, Shuffle and taps play the mixed list; Library hides
 * them again. Opened integrated (`openArtist`'s `integrated`, from a streamed
 * song's artist), it opens with Online selected and asks on its own. Opened
 * from a list that knows the artist, the head is there on the first frame and
 * the rest follows once read.
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
