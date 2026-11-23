import { ArtistShows } from "@/library/ArtistShows";
import { useFollowAction } from "@/library/FollowButton";
import { useScreenContent } from "@/lib/screenTiming";
import { IconUser } from "@tabler/icons-react-native";
import {
  ARTIST_PAGE_SONGS,
  artistInitial,
  artistPageItems,
  discoverTrackId,
  type ArtistPageItem,
  type Catalogue,
  type DiscoverSong,
  type SimilarArtistLink,
  type YtArtistAbout,
  type YtArtistPageNote,
  type YtArtistRelease,
  type YtArtistShelf,
} from "@wave/core";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { AlbumTile } from "@/catalog/AlbumTile";
import { CatalogLine, SECTION_HEAD, SectionHead } from "@/catalog/CatalogLine";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle, ListAction } from "@/catalog/PlayShuffle";
import {
  HiddenSkeletonBox,
  HiddenSkeletonLine,
  PlayShuffleSkeleton,
  TrackSkeletons,
} from "@/catalog/Skeletons";
import { useChromeInset } from "@/chrome/chrome";
import {
  CompactTitleFrame,
  CompactTitleHead,
  CompactTitleMark,
  useCompactTitleTopList,
} from "@/components/CompactTitle";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextButton } from "@/components/TextButton";
import { albumRowHeight, toAlbumSummary } from "@/library/AlbumGrid";
import { ArtistAbout } from "@/library/ArtistAbout";
import { SEE_MORE_ROW, SeeMoreRow } from "@/library/SeeMoreRow";
import { SimilarArtistsRow, similarArtistsRowHeight } from "@/library/SimilarArtistsRow";
import type { AlbumRow, ArtistRow, SongRow } from "@wave/client";
import { openAlbum } from "@/library/routes";
import { useListScrollable } from "@/motion/heldTouch";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openAlbumActions } from "@/playback/ActionsMenu";
import { playPage } from "@/playback/actions";
import {
  artistSelectionItems,
  artistSelectionTarget,
  mixedItemKey,
  type MixedItem,
} from "@/playback/mixedItems";
import { albumSelectionOf, ytAlbumSelectionOf } from "@/selection/mixedSelection";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";
import { listedTrackItem } from "@/playback/actionTargets";
import { useThemeColor } from "@/theme/useThemeColor";
import { useYtArtistPage } from "@/ytmusic/artistPage";
import { mixedSongEntry, mixedPageSongHandlers, songSelection } from "@/songs/mixedSongs";
import { SongList } from "@/songs/SongList";
import { occurrenceKeys } from "@/songs/songRowState";
import { ytArtistNote, YtReleaseTile } from "@/ytmusic/YtArtistSection";
import { useLocalisation } from "@/localisation/localisation";
import { openYtArtistSongs, useOpenedArtistCover, YT_ARTIST_BY_NAME } from "@/ytmusic/routes";
import { PageTopGradient } from "@/pageGradient/PageGradient";

type Song = DiscoverSong<NativeYtSong, SongRow>;
type Release = YtArtistRelease<AlbumRow>;

/** A cover on a shelf: the release, and the shelf it's on (its furniture line falls back to it). */
interface Cover {
  readonly kind: YtArtistShelf<AlbumRow>["kind"];
  readonly release: Release;
}

type Similar = SimilarArtistLink<ArtistRow>;

type Item = ArtistPageItem<Cover, Song, Similar, YtArtistAbout>;

/**
 * What the screen is: the artist's page, or their Songs screen, which its See
 * more opens (docs/spec.md › Artist songs).
 */
type ArtistView = "page" | "songs";

/** How the screen was opened: its route's id (a browse id or `by-name`), the name, offline. */
interface Opened {
  readonly id: string;
  readonly name: string | null;
  readonly offline: boolean;
}

/** Height of a shelf's row, the gap under it included. */
const SHELF_ROW = albumRowHeight(COVER_ROW_TILE);

const NO_SONGS: readonly Song[] = [];

/** The quiet line in place of what the page can't show (while it loads, skeletons show). */
const pageNote = (note: Exclude<YtArtistPageNote, "loading">, strings: Catalogue): string =>
  note === "off" ? strings.library.ytArtistOff : ytArtistNote(note, strings);

/**
 * As the integrated Library artist page lays it out: the releases, then the
 * first songs under their count and See more, then Fans might also like and
 * About.
 */
const pageItems = (
  shelves: readonly YtArtistShelf<AlbumRow>[],
  songs: readonly Song[],
  similar: readonly Similar[],
  about: YtArtistAbout | null,
  { library }: Catalogue,
): Item[] =>
  artistPageItems(
    shelves.map((shelf) => ({
      label: shelf.kind === "albums" ? library.albums : library.singlesAndEps,
      covers: shelf.releases.map((release): Cover => ({ kind: shelf.kind, release })),
    })),
    songs,
    library.countedHeading(library.songs, songs.length),
    null,
    {
      similar: { label: library.fansAlsoLike, artists: similar },
      ...(about === null ? {} : { about }),
    },
    ARTIST_PAGE_SONGS,
  );

/** The Songs screen's list: every song of the artist. */
const songItems = (songs: readonly Song[]): Item[] =>
  songs.map((song, index): Item => ({ type: "song", song, index }));

const itemType = (item: Item): Item["type"] => item.type;

/**
 * A shelf as one row of covers that scrolls sideways: a release the Library
 * has is its album, opened integrated as the page always is; the others are
 * YouTube Music's.
 */
function ReleaseRow({
  covers,
  selection,
}: {
  covers: readonly Cover[];
  selection: ListSelection<MixedItem>;
}) {
  const albums = useMemo(() => albumSelectionOf(selection), [selection]);
  const releases = useMemo(() => ytAlbumSelectionOf(selection), [selection]);
  return (
    <View style={{ height: SHELF_ROW }}>
      <CoverRow staged>
        {covers.map(({ kind, release: { album, library } }) =>
          library === null ? (
            <YtReleaseTile
              key={album.browseId}
              album={album}
              kind={kind}
              size={COVER_ROW_TILE}
              selection={releases}
            />
          ) : (
            <AlbumTile
              key={`album-${library.id}`}
              album={toAlbumSummary(library)}
              size={COVER_ROW_TILE}
              {...selectableRow(
                library,
                albums,
                () => openAlbum(library.id, library, { integrated: true }),
                (options) => openAlbumActions(library, options),
              )}
            />
          ),
        )}
      </CoverRow>
    </View>
  );
}

/** The artist's image from YouTube Music as a large circle, else their initial. */
function YtArtistImage({
  name,
  uri,
  held,
  size,
}: {
  name: string;
  uri: string | null;
  /** The cover drawn before [uri], held until it decodes so the head never blanks. */
  held: string | null;
  size: number;
}) {
  const secondary = useThemeColor("secondary");
  const fill = useThemeColor("fill");
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (uri !== null)
    return (
      <Image
        source={{ uri }}
        placeholder={held === null || held === uri ? undefined : { uri: held }}
        placeholderContentFit="cover"
        style={[circle, { backgroundColor: fill }]}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
    );
  const initial = artistInitial(name);
  return (
    <View className="items-center justify-center overflow-hidden bg-fill" style={circle}>
      {initial === "" ? (
        <IconUser size={size / 3} color={secondary} strokeWidth={1.25} />
      ) : (
        <Text
          className="font-sans font-light text-secondary"
          style={{ fontSize: size * 0.42, lineHeight: size * 0.52 }}
          allowFontScaling={false}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}

/**
 * The page's head, as the Library artist page's: image, name, then Play and
 * Shuffle. While the page loads ([loading]) a still circle stands in for an
 * image not known yet, a line for a name not known yet, and Play and Shuffle
 * have their skeleton.
 */
function Head({
  browseId,
  name,
  artworkUrl,
  cover,
  loading,
  onPlay,
}: {
  browseId: string | null;
  name: string | null;
  artworkUrl: string | null;
  cover: string | null;
  loading: boolean;
  onPlay: ((shuffle: boolean) => void) | null;
}) {
  const follow = useFollowAction({ name: name ?? "", ytBrowseId: browseId });
  const { width } = useWindowDimensions();
  // Three fifths of the content width, on the cell grid.
  const size = Math.floor(((width - grid.margin * 2) * 0.6) / CELL) * CELL;
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL * 2 }}>
      <View className="items-center" style={{ gap: CELL * 2 }}>
        {loading && artworkUrl === null ? (
          <HiddenSkeletonBox width={size} height={size} radius={size / 2} />
        ) : (
          <YtArtistImage name={name ?? ""} uri={artworkUrl} held={cover} size={size} />
        )}
        {name === null ? (
          // A title line (global.css's title1), its bar centred under the circle.
          <View style={{ width: size * 0.8 }}>
            <HiddenSkeletonLine lineHeight={34} width="100%" />
          </View>
        ) : (
          <CompactTitleMark>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              className="text-center font-sans text-title1 font-light text-foreground"
              style={{ letterSpacing: -0.4 }}
            >
              {name}
            </Text>
          </CompactTitleMark>
        )}
      </View>
      {loading ? (
        <PlayShuffleSkeleton />
      ) : onPlay !== null ? (
        <PlayShuffle
          onPlay={() => onPlay(false)}
          onShuffle={() => onPlay(true)}
          last={name === null ? null : follow}
        />
      ) : name !== null ? (
        <ListAction {...follow} />
      ) : null}
    </View>
  );
}

/** The Songs screen's head: the artist's name, "Songs · 42" under it, then Play and Shuffle. */
function SongsHead({
  name,
  count,
  loading,
  onPlay,
}: {
  name: string | null;
  count: number;
  loading: boolean;
  onPlay: ((shuffle: boolean) => void) | null;
}) {
  const { strings } = useLocalisation();
  return (
    <View style={{ gap: CELL, paddingTop: CELL, paddingBottom: CELL * 2 }}>
      {name === null ? (
        <HiddenSkeletonLine lineHeight={34} width="60%" />
      ) : (
        <CompactTitleMark>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            className="font-sans text-title1 font-light text-foreground"
            style={{ letterSpacing: -0.4 }}
          >
            {name}
          </Text>
        </CompactTitleMark>
      )}
      {!loading && (
        <CatalogLine>{strings.library.countedHeading(strings.library.songs, count)}</CatalogLine>
      )}
      {loading ? (
        <PlayShuffleSkeleton />
      ) : onPlay !== null ? (
        <PlayShuffle onPlay={() => onPlay(false)} onShuffle={() => onPlay(true)} />
      ) : null}
    </View>
  );
}

/** A quiet line (offline, YT Music off…) and Try Again when it can be asked again. */
function QuietLine({
  note,
  retry,
  onRetry,
}: {
  note: string | null;
  retry: boolean;
  onRetry: () => void;
}) {
  const { strings } = useLocalisation();
  if (note === null && !retry) return null;
  return (
    <View style={{ paddingTop: CELL * 2 }}>
      {note !== null && (
        <View className="justify-center" style={{ minHeight: CELL * 6 }}>
          <Text className="font-sans text-footnote text-secondary">{note}</Text>
        </View>
      )}
      {retry && <TextButton label={strings.library.tryAgain} onPress={onRetry} />}
    </View>
  );
}

/** The page's list, inside the screen's `CompactTitleFrame`. */
function YtArtistList({
  page: { view, similar, retry, browseId, name, contextId },
  cover,
  shows,
  opened,
}: {
  page: ReturnType<typeof useYtArtistPage>;
  cover: string | null;
  shows: ArtistView;
  opened: Opened;
}) {
  const songsView = shows === "songs";
  const { strings } = useLocalisation();
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const { list, listProps } = useCompactTitleTopList();
  const { fontScale } = useWindowDimensions();
  const similarRow = similarArtistsRowHeight(fontScale);
  const songs = view?.songs ?? NO_SONGS;
  // The page checks the releases and the songs it shows; the Songs screen every song.
  const selectable = useMemo(
    () =>
      view === null
        ? []
        : songsView
          ? artistSelectionItems([], view.songs)
          : artistSelectionItems(view.shelves, view.songs.slice(0, ARTIST_PAGE_SONGS)),
    [view, songsView],
  );
  const selection = useListSelection({
    items: selectable,
    keyOf: mixedItemKey,
    target: artistSelectionTarget,
  });
  const rowSelection = useMemo(
    () =>
      songSelection(selection, (item: Item): MixedItem | null =>
        item.type === "song" ? { kind: "track", item: listedTrackItem(item.song) } : null,
      ),
    [selection],
  );
  const items = useMemo(
    () =>
      view === null
        ? []
        : songsView
          ? songItems(view.songs)
          : pageItems(view.shelves, view.songs, similar, view.about, strings),
    [view, songsView, similar, strings],
  );
  // Songs key by id, a real duplicate by its occurrence, never by place.
  const songKeys = useMemo(() => occurrenceKeys(songs, discoverTrackId), [songs]);
  const itemKey = useCallback(
    (item: Item): string =>
      item.type === "section"
        ? `section-${item.label}`
        : item.type === "shelf"
          ? `shelf-${item.label}`
          : item.type === "similar"
            ? "similar"
            : item.type === "about"
              ? "about"
              : item.type === "more"
                ? "more"
                : (songKeys.get(item.song) ?? discoverTrackId(item.song)),
    [songKeys],
  );
  const context = useMemo(() => ({ kind: "ytArtist", id: contextId }) as const, [contextId]);
  const play = useCallback(
    (startIndex: number | undefined, shuffle = false) =>
      void playPage(songs, startIndex, context, { shuffle }),
    [songs, context],
  );
  // Until the artist's page is in, skeletons hold its place (the view waits on the Library first).
  const loading = view === null || view.note === "loading";
  // The page's own image once it's read, else the cover the tapped tile drew.
  const artworkUrl = view?.artworkUrl ?? cover;
  const header = useMemo(
    () =>
      name === null && !loading ? null : songsView ? (
        <SongsHead
          name={name}
          count={songs.length}
          loading={loading}
          onPlay={songs.length === 0 ? null : (shuffle) => play(undefined, shuffle)}
        />
      ) : (
        <Head
          name={name}
          browseId={browseId}
          artworkUrl={artworkUrl}
          cover={cover}
          loading={loading}
          onPlay={songs.length === 0 ? null : (shuffle) => play(undefined, shuffle)}
        />
      ),
    [name, browseId, artworkUrl, cover, loading, songs.length, play, songsView],
  );
  const footer = useMemo(
    () =>
      loading ? (
        <TrackSkeletons />
      ) : view === null ? null : (
        <QuietLine
          note={view.note === null ? null : pageNote(view.note, strings)}
          retry={view.retry}
          onRetry={retry}
        />
      ),
    [loading, view, retry, strings],
  );
  const contentStyle = useMemo(
    () => ({ paddingHorizontal: grid.margin, paddingBottom: bottomInset }),
    [bottomInset],
  );

  const renderSlot = useCallback(
    ({ item }: { item: Item }) => {
      if (item.type === "section") return <SectionHead label={item.label} />;
      // Keyed by shelf, so a recycled row doesn't keep another shelf's scroll position.
      if (item.type === "shelf")
        return <ReleaseRow key={item.label} covers={item.covers} selection={selection} />;
      if (item.type === "similar")
        return (
          <SimilarArtistsRow
            artists={item.artists}
            height={similarRow}
            selecting={selection.selecting}
          />
        );
      if (item.type === "about") return <ArtistAbout about={item.about} />;
      if (item.type === "more")
        return (
          <SeeMoreRow
            onPress={() => openYtArtistSongs(opened.id, name ?? opened.name, opened.offline)}
          />
        );
      return null;
    },
    [selection, similarRow, opened, name],
  );
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
              : SHELF_ROW,
    [similarRow],
  );

  return (
    <SongList
      {...listProps}
      ref={list}
      scrollEnabled={scrollable}
      className="flex-1"
      data={items}
      keyExtractor={itemKey}
      song={(item) => (item.type === "song" ? mixedSongEntry(item.song) : null)}
      context={context}
      renderSlot={renderSlot}
      slotType={itemType}
      slotSize={slotSize}
      extraData={{ selection: selection.selection, opened, name }}
      selection={rowSelection}
      onPlay={(item) => {
        if (item.type === "song") play(item.index);
      }}
      {...mixedPageSongHandlers}
      contentContainerStyle={contentStyle}
      ListHeaderComponent={
        <CompactTitleHead>
          {header}
          {!songsView && <ArtistShows name={name ?? ""} />}
        </CompactTitleHead>
      }
      ListFooterComponent={footer}
    />
  );
}

/**
 * A YouTube Music artist the Library doesn't have, opened by their browse id
 * (`/library/yt-artist/<UC…>?name=<name>`) or, from a streamed song, by their
 * name (`/library/yt-artist/by-name?name=<name>`, found with an Artists
 * search; "Not found online." when nobody matches): their image and
 * name, Play and Shuffle, their Albums and Singles & EPs (a release the Library has opens
 * the Library album), every song of theirs, their songs playlist read
 * whole (the Library's play its files, the rest stream), Fans might also
 * like, the similar artists YouTube Music lists for them (one the Library has
 * opens the Library's page), and About, their description and counts. It's
 * read as it opens and saved for a week; offline or failing, a quiet line with
 * Try Again, under the similar artists and the About of a page seen before; with YT Music off, it says so.
 */
export default function YtArtistScreen() {
  return <YtArtistScreenOf shows="page" />;
}

/**
 * The YouTube Music artist's Songs screen, which their page's See more opens
 * (`/library/yt-artist/<id>/songs`, `openYtArtistSongs`): the artist's name
 * over "Songs · 42", Play and Shuffle, and every song of theirs, read as the
 * page reads them.
 */
export function YtArtistSongsScreen() {
  return <YtArtistScreenOf shows="songs" />;
}

function YtArtistScreenOf({ shows }: { shows: ArtistView }) {
  useScreenContent(true);
  const params = useLocalSearchParams<{ id: string; name?: string; offline?: string }>();
  const browseId = params.id === YT_ARTIST_BY_NAME ? null : (params.id ?? "");
  const knownName = params.name === undefined || params.name === "" ? null : params.name;
  const offline = params.offline === "1";
  const page = useYtArtistPage(browseId, knownName, offline);
  const cover = useOpenedArtistCover(browseId);
  const id = params.id ?? "";
  const opened = useMemo(() => ({ id, name: knownName, offline }), [id, knownName, offline]);
  return (
    <CompactTitleFrame title={page.name ?? undefined}>
      <View className="flex-1 bg-background">
        <PageTopGradient />
        <ScreenHeader />
        <YtArtistList page={page} cover={cover} shows={shows} opened={opened} />
      </View>
    </CompactTitleFrame>
  );
}
