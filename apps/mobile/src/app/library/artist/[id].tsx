import { ArtistShows } from "@/library/ArtistShows";
import { useFollowAction } from "@/library/FollowButton";
import { useScreenContent } from "@/lib/screenTiming";

import {
  ARTIST_PAGE_SONGS,
  artistPageItems,
  artistSongOrder,
  sortSongs,
  ytTrackId,
  type ArtistPageItem,
  type Catalogue,
  type RankedArtistSong,
  type SongSort,
  type SimilarArtistLink,
  type YtArtistAbout,
  type YtArtistAlbum,
} from "@wave/core";
import type { LegendListRef } from "@legendapp/list/react-native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { SECTION_HEAD, SectionHead } from "@/catalog/CatalogLine";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL, grid } from "@/catalog/grid";
import {
  AlbumCardSkeleton,
  SKELETON_TILES,
  SkeletonGroup,
  TrackSkeletons,
} from "@/catalog/Skeletons";

import { useChromeInset } from "@/chrome/chrome";
import { CompactTitleHead, CompactTitleMark, useCompactTitleList } from "@/components/CompactTitle";
import { useListScroll } from "@/lib/useListScroll";
import { playPage } from "@/playback/actions";

import { openAlbumActions } from "@/playback/ActionsMenu";
import { mixedTarget, type MixedItem } from "@/playback/actionTargets";
import {
  albumItem,
  ytAlbumItem,
  trackItem,
  ytTrackItem,
  mixedItemKey,
} from "@/playback/mixedItems";
import { albumSelectionOf, ytAlbumSelectionOf } from "@/selection/mixedSelection";
import { toAlbumSummary } from "@/library/AlbumGrid";
import { ArtistAbout } from "@/library/ArtistAbout";
import { DetailFrame } from "@/library/DetailFrame";
import { entryText, FindFrame, FindHead, useFindInLegendList } from "@/library/FindInPlaylist";

import { useArtist } from "@/library/hooks";
import { LibraryAlbumCard } from "@/library/LibraryAlbumCard";
import type { AlbumRow, ArtistDetail, ArtistRow, SongRow } from "@wave/client";
import {
  openAlbum,
  openArtistSongs,
  parseId,
  useKnownRow,
  useOpenedIntegrated,
} from "@/library/routes";
import { SEE_MORE_ROW, SeeMoreRow } from "@/library/SeeMoreRow";
import { SimilarArtistsRow, similarArtistsRowHeight } from "@/library/SimilarArtistsRow";
import { SongSortButton } from "@/library/SongSortButton";
import { useSongSort } from "@/library/songSort";
import { ListIntro, songCount } from "@/library/TrackList";
import { useLocalisation } from "@/localisation/localisation";
import { SongList } from "@/songs/SongList";
import type { SongListEntry } from "@/songs/songListSources";
import { mixedSongEntry, mixedPageSongHandlers, songSelection } from "@/songs/mixedSongs";
import { useListScrollable } from "@/motion/heldTouch";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";
import { ArtistStatsBlock } from "@/stats/ArtistStatsBlock";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useArtistKeptPage, type ArtistKeptPageShown } from "@/ytmusic/artistKeptPage";
import { useArtistSongsFinder, useYtArtistSection } from "@/ytmusic/artistSection";
import { useHeldSongs, useSongsInPlace } from "@/ytmusic/songsInPlace";
import { ytArtistNote, YtReleaseCard } from "@/ytmusic/YtArtistSection";
import { YtLookupFooter } from "@/ytmusic/YtLookupFooter";

/** A cover on one of the page's album shelves: a Library album, or a release only YouTube Music has. */
type AlbumCell =
  | { readonly kind: "library"; readonly album: AlbumRow }
  | { readonly kind: "yt"; readonly album: YtArtistAlbum }
  /** Skeleton tiles where YouTube Music's releases will go, while it's asked. */
  | { readonly kind: "skeleton" };

const SKELETON_CELL: AlbumCell = { kind: "skeleton" };

/**
 * A row of the Songs section: the Library's song, or a song of the artist YouTube Music adds,
 * with its rank under Popular (`artistSongOrder`).
 */
type PageSong = RankedArtistSong<NativeYtSong, SongRow>;

type Similar = SimilarArtistLink<ArtistRow>;

type Item = ArtistPageItem<AlbumCell, PageSong, Similar, YtArtistAbout>;

/**
 * What the screen is: the artist's page, or their Songs screen, which its See
 * more opens (docs/spec.md › Artist songs).
 */
type ArtistView = "page" | "songs";

/** The artist page's songs are always in Popular order; the Songs screen has the chosen sort. */
const POPULAR: SongSort = { key: "popular", descending: false };

/** Neither Fans might also like nor About: no page kept, or its place taken by skeletons. */
const NOTHING_KEPT: ArtistKeptPageShown = { similar: [], about: null };

/** Space under an album shelf's row, before the next heading. */
const SHELF_GAP = CELL * 3;

/**
 * Height of an album shelf's row: the cover, the card's caption under it (a title line and an artist
 * line, global.css's body and footnote line heights, grown with the font) and the gap below.
 */
const shelfRowHeight = (fontScale: number): number =>
  COVER_ROW_TILE + CELL + Math.ceil(((22 + 18) * Math.max(1, fontScale)) / CELL) * CELL + SHELF_GAP;

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

/**
 * The page's shelves and songs, the songs under [songsLabel]. While YouTube
 * Music is asked ([loading]), skeleton tiles follow the Library's albums where
 * its releases will go. Past the first [shown] songs, See more takes the
 * rest's place. After the songs come Fans might also like and About,
 * from the artist's [kept] YouTube Music page. While Find in artist narrows
 * the songs ([found]), only the songs found show.
 */
const artistItems = (
  detail: ArtistDetail,
  songs: readonly PageSong[],
  yt: YtAdditions,
  loading: boolean,
  songsLabel: string,
  { library }: Catalogue,
  found: readonly number[] | null,
  kept: ArtistKeptPageShown,
  shown: number,
): Item[] =>
  artistPageItems(
    [
      // YouTube Music's releases the Library lacks follow the Library's own, on one shelf.
      {
        label: library.albums,
        covers: [
          ...detail.albums.map(libraryCell),
          ...yt.albums.map((album): AlbumCell => ({ kind: "yt", album })),
          ...(loading ? [SKELETON_CELL] : []),
        ],
      },
      {
        label: library.singlesAndEps,
        covers: yt.singles.map((album): AlbumCell => ({ kind: "yt", album })),
      },
      { label: library.appearsOn, covers: detail.appearsOn.map(libraryCell) },
    ],
    songs,
    songsLabel,
    found,
    {
      similar: { label: library.fansAlsoLike, artists: kept.similar },
      ...(kept.about === null ? {} : { about: kept.about }),
    },
    shown,
  );

const itemKey = (item: Item): string => {
  switch (item.type) {
    case "section":
      return `section-${item.label}`;
    case "shelf":
      return `shelf-${item.label}`;
    case "similar":
      return "similar";
    case "about":
      return "about";
    case "more":
      return "more";
    case "song":
      return item.song.source === "library"
        ? String(item.song.track.id)
        : ytTrackId(item.song.song.videoId);
  }
};

/**
 * What can be checked on the page, in page order: the albums (their shelf,
 * then Appears on), then the songs it shows. Albums and songs check together.
 */
const selectableItems = (
  detail: ArtistDetail,
  songs: readonly PageSong[],
  yt: YtAdditions,
): MixedItem[] => [
  ...detail.albums.map(albumItem),
  ...yt.albums.map(ytAlbumItem),
  ...yt.singles.map(ytAlbumItem),
  ...detail.appearsOn.map(albumItem),
  ...songs.map(songItem),
];

const songItem = (row: PageSong): MixedItem =>
  row.source === "library" ? trackItem(row.track) : ytTrackItem(row.song);

/** The Songs screen's list: every song, or while Find narrows them, the songs found. */
const songItems = (songs: readonly PageSong[], found: readonly number[] | null): Item[] =>
  artistPageItems<AlbumCell, PageSong, Similar, YtArtistAbout>([], songs, "", found).filter(
    (item) => item.type === "song",
  );

/**
 * An album shelf as one row of covers that scrolls sideways: Library albums
 * (tap opens, long-press the menu, selectable) and YouTube Music's releases
 * the Library lacks.
 */
function AlbumShelfRow({
  cells,
  selection,
  releases,
  integrated,
  height,
}: {
  cells: readonly AlbumCell[];
  selection: ListSelection<AlbumRow>;
  releases: ListSelection<YtArtistAlbum>;
  /** Whether the page is an integrated view: the albums open integrated. */
  integrated: boolean;
  height: number;
}) {
  const { strings } = useLocalisation();
  return (
    <View style={{ height }}>
      <CoverRow staged>
        {cells.map((cell) => {
          switch (cell.kind) {
            case "library": {
              const album = toAlbumSummary(cell.album);
              return (
                <LibraryAlbumCard
                  key={cellKey(cell)}
                  albumId={cell.album.id}
                  title={album.title}
                  artist={album.albumArtist}
                  artworkUri={album.artworkUri}
                  size={COVER_ROW_TILE}
                  {...selectableRow(
                    cell.album,
                    selection,
                    () => openAlbum(cell.album.id, cell.album, { integrated }),
                    (options) => openAlbumActions(cell.album, options),
                  )}
                />
              );
            }
            case "yt":
              return (
                <YtReleaseCard
                  key={cellKey(cell)}
                  album={cell.album}
                  size={COVER_ROW_TILE}
                  selection={releases}
                />
              );
            case "skeleton":
              return (
                <SkeletonGroup key={cellKey(cell)} label={strings.library.loadingAlbums}>
                  <View className="flex-row" style={{ gap: grid.gutter }}>
                    {Array.from({ length: SKELETON_TILES }, (_, index) => (
                      <AlbumCardSkeleton key={index} size={COVER_ROW_TILE} />
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

/** The Songs screen's head: the artist's name as its title. */
function ArtistSongsHead({ artist }: { artist: ArtistRow }) {
  return (
    <View style={{ paddingTop: CELL, paddingBottom: CELL }}>
      <CompactTitleMark>
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          className="font-sans text-title1 font-light text-foreground"
          style={{ letterSpacing: -0.4 }}
        >
          {artist.name}
        </Text>
      </CompactTitleMark>
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
      <CompactTitleMark>
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          className="text-center font-sans text-title1 font-light text-foreground"
          style={{ letterSpacing: -0.4 }}
        >
          {artist.name}
        </Text>
      </CompactTitleMark>
    </View>
  );
}

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

const selectedSong = (item: Item): MixedItem | null =>
  item.type !== "song"
    ? null
    : item.song.source === "library"
      ? trackItem(item.song.track)
      : ytTrackItem(item.song.song);

function ArtistContent({
  shown,
  openedIntegrated,
  view,
}: {
  shown: Shown;
  openedIntegrated: boolean;
  view: ArtistView;
}) {
  const { strings } = useLocalisation();
  const songsView = view === "songs";
  const loaded = shown.detail !== undefined;
  const detail = useMemo(() => shown.detail ?? unread(shown.artist), [shown.detail, shown.artist]);
  const scrollable = useListScrollable();
  const list = useRef<LegendListRef>(null);
  const { fontScale } = useWindowDimensions();
  const shelfHeight = shelfRowHeight(fontScale);
  const similarRow = similarArtistsRowHeight(fontScale);
  const bottomInset = useChromeInset();
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
    loaded,
  );
  const ytView = loaded ? yt.view : null;
  const ytShelves = loaded ? yt.shelves : null;
  const integrated = loaded && yt.integrated;
  // The page lists the artist's songs by popularity whatever the sort chosen for artists; the
  // Songs screen in that sort (Popular by default). `artistSongOrder` below ranks them by
  // YouTube Music's list once it's known.
  const chosenSort = useSongSort("artist");
  const sort = songsView ? chosenSort : POPULAR;
  const songs = useMemo(() => sortSongs(detail.songs, sort), [detail.songs, sort]);
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
  const find = useArtistSongsFinder(songs, yt.find);
  const placed = useSongsInPlace(holding, additions.songs, find);
  const librarySongs = useMemo(
    () => (placed.tracks.size === 0 ? songs : songs.filter((song) => !placed.tracks.has(song.id))),
    [songs, placed.tracks],
  );
  // Popular ranks by the saved list, merging the visible online list in. Other sorts keep their
  // existing order. Playback and displayed rows use this same Core result.
  const onlineSongsShown = integrated && yt.find !== null && ytView?.toggle === "online";
  const pageSongs = useMemo(
    () =>
      artistSongOrder(
        [...librarySongs.map((track) => ({ source: "library" as const, track })), ...placed.songs],
        yt.popular,
        { sort: sort.key, online: onlineSongsShown },
      ),
    [librarySongs, placed.songs, yt.popular, sort.key, onlineSongsShown],
  );
  // Play, Shuffle and rows play this list by one rule (`playPage`): with YouTube Music's songs
  // on the page (an integrated view) the mixed list, the Library's files and the artist's songs
  // streamed; otherwise the Library's songs alone.
  // While YouTube Music is asked, skeletons stand where its releases and songs will go.
  const ytLoading = ytView?.note === "loading";
  // Fans might also like and About, from the artist's YouTube Music page: looked up once the
  // page is read and the screen has settled, never before the songs and albums. While
  // YouTube Music's songs are on their way, their skeletons follow the songs instead.
  // The Songs screen has neither, and looks nothing up.
  const keptPage = useArtistKeptPage(detail.artist.name, loaded && !songsView, yt);
  const kept = ytLoading || songsView ? NOTHING_KEPT : keptPage;
  // Find in artist narrows the songs on the page, the Library's or the mixed list with Online.
  const findInArtist = useFindInLegendList(list, pageSongs, entryText, true);
  const { found } = findInArtist;
  const { scroll, listProps } = useListScroll(findInArtist.initialOffset);
  useCompactTitleList({ list, find: findInArtist, scroll });
  // The songs' heading counts the whole list as it stands, the cut's hidden songs included.
  const heading = strings.library.countedHeading(
    byPopularity ? strings.library.popular : strings.library.songs,
    pageSongs.length,
  );
  const items = useMemo(
    () =>
      songsView
        ? songItems(pageSongs, found)
        : artistItems(
            detail,
            pageSongs,
            additions,
            ytLoading,
            heading,
            strings,
            found,
            kept,
            ARTIST_PAGE_SONGS,
          ),
    [songsView, detail, pageSongs, additions, ytLoading, heading, strings, found, kept],
  );
  // The songs the screen shows: past the page's cut they're the Songs screen's to show.
  const shownSongs = useMemo(
    () => (songsView || found !== null ? pageSongs : pageSongs.slice(0, ARTIST_PAGE_SONGS)),
    [songsView, found, pageSongs],
  );
  // Albums and songs select together; the bar acts on them in page order.
  const selectable = useMemo(
    () => (songsView ? shownSongs.map(songItem) : selectableItems(detail, shownSongs, additions)),
    [songsView, detail, shownSongs, additions],
  );
  const page = useListSelection({ items: selectable, keyOf: mixedItemKey, target: mixedTarget });
  const albumSelection = useMemo(() => albumSelectionOf(page), [page]);
  const releaseSelection = useMemo(() => ytAlbumSelectionOf(page), [page]);
  const rowSelection = useMemo(() => songSelection(page, selectedSong), [page]);
  const { selecting } = page;
  const context = useMemo(
    () => ({ kind: "artist", id: String(detail.artist.id) }) as const,
    [detail.artist.id],
  );

  const source = useCallback(
    (item: Item): SongListEntry | null => {
      if (item.type !== "song") return null;
      const rank = item.song.popularRank;
      const leading =
        byPopularity && item.song.source === "library"
          ? rank === undefined
            ? { kind: "trackNumber" as const }
            : { kind: "rank" as const, number: rank }
          : rank === undefined
            ? { kind: "playDisc" as const }
            : { kind: "rank" as const, number: rank };
      return mixedSongEntry(item.song, { leading, kindLine: true });
    },
    [byPopularity],
  );
  const renderSlot = useCallback(
    ({ item }: { item: Item }) => {
      if (item.type === "section") return <SectionHead label={item.label} />;
      if (item.type === "shelf")
        return (
          <AlbumShelfRow
            key={item.label}
            cells={item.covers}
            selection={albumSelection}
            releases={releaseSelection}
            integrated={integrated}
            height={shelfHeight}
          />
        );
      if (item.type === "similar")
        return (
          <SimilarArtistsRow artists={item.artists} height={similarRow} selecting={selecting} />
        );
      if (item.type === "about") return <ArtistAbout about={item.about} />;
      if (item.type === "more")
        return (
          <SeeMoreRow
            onPress={() => openArtistSongs(detail.artist.id, { integrated: openedIntegrated })}
          />
        );
      return null;
    },
    [
      albumSelection,
      releaseSelection,
      integrated,
      shelfHeight,
      similarRow,
      selecting,
      detail.artist.id,
      openedIntegrated,
    ],
  );
  // About's height follows its text, so the list measures it.
  const slotSize = useCallback(
    (item: Item): number | undefined =>
      item.type === "section"
        ? SECTION_HEAD
        : item.type === "similar"
          ? similarRow
          : item.type === "about"
            ? undefined
            : item.type === "more"
              ? SEE_MORE_ROW
              : shelfHeight,
    [shelfHeight, similarRow],
  );

  // With Online and an answer found, the counts take in what YouTube Music adds to the page.
  const local = {
    albums: detail.artist.albumCount,
    songs: loaded ? songs.length : detail.artist.trackCount,
  };
  const counts = loaded ? yt.counts(local) : local;
  const line = [
    counts.albums > 0 ? strings.library.albumCount(counts.albums) : null,
    songCount(counts.songs, strings),
  ]
    .filter((part) => part !== null)
    .join(" · ");

  // The sort is the Songs screen's: the page's songs are always by popularity.
  const head = songsView ? (
    <>
      <ArtistSongsHead artist={detail.artist} />
      <ListIntro
        line={strings.library.countedHeading(strings.library.songs, pageSongs.length)}
        songs={loaded ? songs : undefined}
        mixed={loaded ? pageSongs : undefined}
        context={context}
        sortControl={<SongSortButton kind="artist" />}
        toggle={loaded ? yt.toggle : null}
      />
    </>
  ) : (
    <>
      <ArtistHead artist={detail.artist} />
      <FollowArtistIntro
        artist={detail.artist}
        line={line}
        songs={loaded ? songs : undefined}
        mixed={loaded ? pageSongs : undefined}
        context={context}
        toggle={loaded ? yt.toggle : null}
      />
      <ArtistShows name={detail.artist.name} />
      {loaded && <ArtistStatsBlock artistId={detail.artist.id} songs={detail.songs} />}
    </>
  );
  // Past the page's cut, skeleton rows for YouTube Music's songs would have no place to show.
  const songSkeletons = songsView || found !== null || pageSongs.length < ARTIST_PAGE_SONGS;

  return (
    <FindFrame find={findInArtist} of="artist">
      <SongList
        {...listProps}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={items}
        keyExtractor={itemKey}
        song={source}
        context={context}
        renderSlot={renderSlot}
        slotType={(item) => item.type}
        slotSize={slotSize}
        extraData={{
          albumSelection,
          releaseSelection,
          integrated,
          shelfHeight,
          similarRow,
          selecting,
        }}
        selection={rowSelection}
        onPlay={(item) => {
          if (item.type === "song") void playPage(pageSongs, item.index, context);
        }}
        {...mixedPageSongHandlers}
        contentContainerStyle={{
          paddingHorizontal: grid.margin,
          paddingBottom: bottomInset,
          minHeight: findInArtist.minHeight,
        }}
        initialScrollOffset={findInArtist.initialOffset}
        ListHeaderComponent={
          // YouTube Music's songs still on their way stand under the skeletons, not "No songs match".
          <CompactTitleHead>
            <FindHead find={findInArtist} header={head} of="artist" allRead={!ytLoading} />
          </CompactTitleHead>
        }
        ListFooterComponent={
          ytView === null ? null : ytView.note === "loading" ? (
            songSkeletons ? (
              <TrackSkeletons leading="card" />
            ) : null
          ) : (
            <YtLookupFooter
              note={ytView.note === null ? null : ytArtistNote(ytView.note, strings)}
            />
          )
        }
      />
    </FindFrame>
  );
}

/**
 * An artist: their albums, the albums they appear on (each shelf one row of
 * covers that scrolls sideways), their songs and, while YT Music is on, a
 * Library | Online toggle after Play and Shuffle (asked only once Online is
 * picked): then the releases and every song YouTube Music has of theirs that
 * the Library lacks join the albums and songs, and Play, Shuffle and taps
 * play the mixed list; Library hides them again. After the songs come Fans
 * might also like and About, from the artist's YouTube Music page, found by
 * name once and kept (`useArtistKeptPage`); with no page kept there is neither.
 * Find in artist, over the
 * page, narrows the songs shown (the shelves, the head and those two step aside). Opened integrated
 * (`openArtist`'s `integrated`, from a streamed song's artist), it opens with
 * Online selected and asks on its own. Opened
 * from a list that knows the artist, the head is there on the first frame and
 * the rest follows once read.
 */
export default function ArtistScreen() {
  return <ArtistScreenOf view="page" />;
}

/**
 * An artist's Songs screen, which their page's See more opens on the same
 * stack (`openArtistSongs`): the artist's name over "Songs · 42", Play,
 * Shuffle, the sort, the Library | Online toggle and every song in the sort
 * chosen for artists, with Find in artist and selection. The sort and the
 * toggle are the page's own (`artistVisit`).
 */
export function ArtistSongsScreen() {
  return <ArtistScreenOf view="songs" />;
}

function ArtistScreenOf({ view }: { view: ArtistView }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const artistId = parseId(id);
  const detail = useArtist(artistId);
  useScreenContent(detail !== undefined);
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
    <DetailFrame detail={shown} noun="artist" compactTitle={({ artist }) => artist.name}>
      {(artist) => <ArtistContent shown={artist} openedIntegrated={openedIntegrated} view={view} />}
    </DetailFrame>
  );
}

function FollowArtistIntro({
  artist,
  ...props
}: React.ComponentProps<typeof ListIntro> & { artist: ArtistRow }) {
  const last = useFollowAction(artist);
  return <ListIntro {...props} last={last} />;
}
