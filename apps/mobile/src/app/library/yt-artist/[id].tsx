import { ArtistShows } from "@/library/ArtistShows";
import { useFollowAction } from "@/library/FollowButton";
import { useScreenContent } from "@/lib/screenTiming";
import { IconUser } from "@tabler/icons-react-native";
import {
  artistInitial,
  artistPageItems,
  discoverTrackId,
  type ArtistPageItem,
  type Catalogue,
  type DiscoverSong,
  type YtArtistPageNote,
  type YtArtistRelease,
  type YtArtistShelf,
} from "@wave/core";
import type { LegendListRef } from "@legendapp/list/react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { AlbumTile } from "@/catalog/AlbumTile";
import { SECTION_HEAD, SectionHead } from "@/catalog/CatalogLine";
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
  useCompactTitleList,
} from "@/components/CompactTitle";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextButton } from "@/components/TextButton";
import { albumRowHeight, toAlbumSummary } from "@/library/AlbumGrid";
import type { AlbumRow, SongRow } from "@/library/LibraryStore";
import { openAlbum } from "@/library/routes";
import { useListScroll } from "@/lib/useListScroll";
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
import { YT_ARTIST_BY_NAME } from "@/ytmusic/routes";

type Song = DiscoverSong<NativeYtSong, SongRow>;
type Release = YtArtistRelease<AlbumRow>;

/** A cover on a shelf: the release, and the shelf it's on (its furniture line falls back to it). */
interface Cover {
  readonly kind: YtArtistShelf<AlbumRow>["kind"];
  readonly release: Release;
}

type Item = ArtistPageItem<Cover, Song>;

/** Height of a shelf's row, the gap under it included. */
const SHELF_ROW = albumRowHeight(COVER_ROW_TILE);

const NO_SONGS: readonly Song[] = [];

/** The quiet line in place of what the page can't show (while it loads, skeletons show). */
const pageNote = (note: Exclude<YtArtistPageNote, "loading">, strings: Catalogue): string =>
  note === "off" ? strings.library.ytArtistOff : ytArtistNote(note, strings);

/** As the integrated Library artist page lays it out: the releases, then the songs. */
const pageItems = (
  shelves: readonly YtArtistShelf<AlbumRow>[],
  songs: readonly Song[],
  { library }: Catalogue,
): Item[] =>
  artistPageItems(
    shelves.map((shelf) => ({
      label: shelf.kind === "albums" ? library.albums : library.singlesAndEps,
      covers: shelf.releases.map((release): Cover => ({ kind: shelf.kind, release })),
    })),
    songs,
  );

const itemType = (item: Item): Item["type"] => item.type;
const slotSize = (item: Item): number => (item.type === "section" ? SECTION_HEAD : SHELF_ROW);

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
      <CoverRow>
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
function YtArtistImage({ name, uri, size }: { name: string; uri: string | null; size: number }) {
  const secondary = useThemeColor("secondary");
  const fill = useThemeColor("fill");
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (uri !== null)
    return (
      <Image
        source={{ uri }}
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
  loading,
  onPlay,
}: {
  browseId: string | null;
  name: string | null;
  artworkUrl: string | null;
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
          <YtArtistImage name={name ?? ""} uri={artworkUrl} size={size} />
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
  page: { view, retry, browseId, name, contextId },
}: {
  page: ReturnType<typeof useYtArtistPage>;
}) {
  const { strings } = useLocalisation();
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const list = useRef<LegendListRef>(null);
  const { scroll, listProps } = useListScroll(0);
  useCompactTitleList({ list, find: null, scroll });
  const songs = view?.songs ?? NO_SONGS;
  const selectable = useMemo(
    () => (view === null ? [] : artistSelectionItems(view.shelves, view.songs)),
    [view],
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
    () => (view === null ? [] : pageItems(view.shelves, view.songs, strings)),
    [view, strings],
  );
  // Songs key by id, a real duplicate by its occurrence, never by place.
  const songKeys = useMemo(() => occurrenceKeys(songs, discoverTrackId), [songs]);
  const itemKey = useCallback(
    (item: Item): string =>
      item.type === "section"
        ? `section-${item.label}`
        : item.type === "shelf"
          ? `shelf-${item.label}`
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
  const artworkUrl = view?.artworkUrl ?? null;
  const header = useMemo(
    () =>
      name === null && !loading ? null : (
        <Head
          name={name}
          browseId={browseId}
          artworkUrl={artworkUrl}
          loading={loading}
          onPlay={songs.length === 0 ? null : (shuffle) => play(undefined, shuffle)}
        />
      ),
    [name, browseId, artworkUrl, loading, songs.length, play],
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
      return null;
    },
    [selection],
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
      extraData={selection.selection}
      selection={rowSelection}
      onPlay={(item) => {
        if (item.type === "song") play(item.index);
      }}
      {...mixedPageSongHandlers}
      contentContainerStyle={contentStyle}
      ListHeaderComponent={
        <CompactTitleHead>
          {header}
          <ArtistShows name={name ?? ""} />
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
 * the Library album) and every song of theirs, their songs playlist read
 * whole (the Library's play its files, the rest stream). It's read as it opens and saved for a week; offline or
 * failing, a quiet line with Try Again; with YT Music off, it says so.
 */
export default function YtArtistScreen() {
  useScreenContent(true);
  const params = useLocalSearchParams<{ id: string; name?: string; offline?: string }>();
  const browseId = params.id === YT_ARTIST_BY_NAME ? null : (params.id ?? "");
  const knownName = params.name === undefined || params.name === "" ? null : params.name;
  const page = useYtArtistPage(browseId, knownName, params.offline === "1");
  return (
    <CompactTitleFrame title={page.name ?? undefined}>
      <View className="flex-1 bg-background">
        <ScreenHeader />
        <YtArtistList page={page} />
      </View>
    </CompactTitleFrame>
  );
}
