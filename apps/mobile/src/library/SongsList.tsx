import { useScreenContent } from "@/lib/screenTiming";
import {
  LegendList,
  type LegendListRef,
  type OnViewableItemsChangedInfo,
} from "@legendapp/list/react-native";
import { IconMusic } from "@tabler/icons-react-native";
import { hasFindQuery, librarySongSort, PAGED_ROWS_LIMITS, showsExplicitBadge } from "@wave/core";
import { useScrollToTop } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { songRowLine } from "@/catalog/cards/SongCard";
import { CELL, grid } from "@/catalog/grid";
import type { TrackSummary } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { TextButton } from "@/components/TextButton";
import { fileUri } from "@/lib/fileUri";
import { useListScrollable } from "@/motion/heldTouch";
import { perfMark, useRenderCount } from "@/perf/perf";
import { playTrackIds } from "@/playback/actions";
import { openTrackActionsById } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/actionTargets";
import { useCurrentPlayingIds } from "@/playback/hooks";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection } from "@/selection/useListSelection";

import { useFavoriteIds } from "./favorites";
import { FIND_FIELD_HEIGHT, FindHead, useFindInLegendList } from "./FindInPlaylist";
import { folderPhrase } from "./folderPhrase";
import { useScanRoots, useScanState } from "./hooks";
import type { SongOrder, SongRow, SongSummary } from "./LibraryStore";
import { LibraryReadFeedback, LibraryReadNote } from "./LibraryReadFeedback";
import { songOrderQueryKey, usePagedSongs, useSongFindTexts, useSongOrder } from "./pagedSongs";
import { promptForMusicFolder } from "./promptForMusicFolder";
import { songsWithIds } from "./sectionSongs";
import { SongSortButton } from "./SongSortButton";
import { libraryQueryState } from "./sharedQueries";
import { SwipeSummaryRow } from "./SwipeTrackRow";
import { useSongSort } from "./songSort";
import { ListIntroLayout, songCount } from "./TrackList";
import { useSpineEntries } from "./useSpine";

/** Tapping a song plays the whole Songs list from it. */
const SONGS_CONTEXT = { kind: "songs", id: null } as const;

/**
 * Library › Songs: every track in the sort you chose (by title until then),
 * virtualised and read in pages for libraries of tens of thousands (#310):
 * the whole list is known as Track ids, and only the rows near the screen are
 * read. Play, Shuffle, taps and selections act on the whole list, reading
 * the rows they need when they run.
 */
export function SongsList() {
  useRenderCount("SongsList");
  const sort = librarySongSort(useSongSort("songs"));
  const read = useSongOrder(sort);
  // Another sort's order shows until this one's is read, rather than an empty screen.
  const [last, setLast] = useState<SongOrder | null>(null);
  if (read !== null && read !== last) setLast(read);
  const order = read ?? last;
  useScreenContent(order !== null && order.ids.length === 0);
  const scan = useScanState();
  const roots = useScanRoots();

  if (order === null)
    return <LibraryReadFeedback queryKey={songOrderQueryKey(sort)} label="songs" scan />;

  if (order.ids.length === 0) {
    return (
      <View style={{ paddingHorizontal: grid.margin }}>
        <ScanProgressBanner />
        <EmptyState
          icon={IconMusic}
          title={scan.status === "scanning" ? "Looking for songs" : "No songs"}
          message={
            scan.status === "scanning"
              ? "Songs appear here as Wave finds them."
              : `Wave didn't find any songs in ${folderPhrase(roots)}.`
          }
          action={
            scan.status === "scanning" ? undefined : (
              <TextButton label="Choose music folder" onPress={() => void promptForMusicFolder()} />
            )
          }
        />
      </View>
    );
  }

  const queryKey = songOrderQueryKey(sort);
  return (
    <PagedSongList
      order={order}
      orderError={read === null && libraryQueryState(queryKey) === "error" ? queryKey : undefined}
    />
  );
}

/** A row of the Songs list as `TrackRow` draws it. */
const toTrackSummary = (song: SongSummary): TrackSummary => ({
  id: String(song.id),
  title: song.title,
  artist: song.artist,
  durationMs: song.durationMs,
  artworkUri: fileUri(song.thumbPath),
  // A missing song: dimmed, as a YT Music song not downloaded is.
  missingTrackId: song.hasFile ? undefined : song.id,
  explicit: showsExplicitBadge(song.explicit),
});

/** A row whose page is still being read: its thumbnail's place, and nothing to press. */
function LoadingRow() {
  return (
    <View
      accessible
      accessibilityLabel="Loading song"
      className="flex-row items-center"
      style={{ height: grid.row }}
    >
      <Artwork uri={undefined} size={CELL * 5} radius={CELL / 2} />
    </View>
  );
}

const keyExtractor = (id: number): string => String(id);

const NO_ROWS: ReadonlyMap<number, SongRow> = new Map();

/** Rows read past the screen each way while selecting, so checking one acts at once. */
const SELECTING_AHEAD = PAGED_ROWS_LIMITS.pageSize;

/**
 * The Songs list over [order]: rows read a page at a time, the spine from the
 * order's letters, and every action on the whole order. Find in Songs waits
 * above the head until the list is pulled down; a query narrows the rows to
 * the songs found, in the order's order, and hides the spine.
 */
function PagedSongList({
  order,
  orderError,
}: {
  order: SongOrder;
  orderError: string | undefined;
}) {
  useRenderCount("PagedSongList");
  const scrollable = useListScrollable();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const bottomInset = useChromeInset();
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  // Find in Songs: what finds each song is read once a query is first typed.
  const [findWanted, setFindWanted] = useState(false);
  const findTexts = useSongFindTexts(findWanted);
  const describe = useCallback((id: number) => findTexts?.get(id) ?? null, [findTexts]);
  const find = useFindInLegendList(list, order.ids, describe, true);
  if (!findWanted && hasFindQuery(find.query)) setFindWanted(true);
  const { found, shown: shownIds, placeOf } = find;
  const { pages, version } = usePagedSongs(shownIds);
  useScreenContent(shownIds.length === 0 || pages.row(0) !== undefined || version > 0);
  const missing = useMemo(() => new Set(order.missing), [order]);
  const spine = useSpineEntries(order.spine, list);

  // Selecting: the checked songs' full rows (what the actions need), and those
  // near the screen, read as they're needed and dropped when selecting ends.
  const [full, setFull] = useState(NO_ROWS);
  const asked = useRef(new Set<number>());
  const shown = useRef({ start: 0, end: PAGED_ROWS_LIMITS.pageSize });
  const want = useCallback((ids: readonly number[]) => {
    const wanted = ids.filter((id) => !asked.current.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) asked.current.add(id);
    songsWithIds(wanted).then(
      (rows) => {
        if (rows.length === 0) return;
        setFull((before) => {
          const next = new Map(before);
          for (const row of rows) next.set(row.id, row);
          return next;
        });
      },
      () => {
        for (const id of wanted) asked.current.delete(id);
      },
    );
  }, []);
  // Every checked song, in the list's order, once all their rows are read.
  const target = useCallback(
    (ids: readonly number[]): ActionItems | null => {
      const items: { song: SongRow }[] = [];
      for (const id of ids) {
        const song = full.get(id);
        if (song === undefined) return null;
        items.push({ song });
      }
      return { kind: "track", items };
    },
    [full],
  );
  const listSelection = useListSelection({ items: order.ids, keyOf: keyExtractor, target });
  const { selection } = listSelection;
  const nearScreen = useCallback(
    () =>
      shownIds.slice(
        Math.max(0, shown.current.start - SELECTING_AHEAD),
        shown.current.end + SELECTING_AHEAD,
      ),
    [shownIds],
  );
  useEffect(() => {
    if (selection === null) {
      asked.current.clear();
      setFull(NO_ROWS);
      return;
    }
    want([...selection.keys].map(Number));
    want(nearScreen());
  }, [selection, want, nearScreen]);

  const onViewableItemsChanged = useCallback(
    ({ startBuffered, endBuffered }: OnViewableItemsChangedInfo<number>) => {
      const start = Math.max(0, startBuffered);
      const end = Math.max(start, endBuffered + 1);
      shown.current = { start, end };
      pages.view(start, end);
      if (selection !== null) want(nearScreen());
    },
    [pages, selection, want, nearScreen],
  );

  // The response in the release runner's push-tracklist scenario: the first rows on screen.
  const first = order.ids[0];
  const ready = first !== undefined && pages.rowOf(first) !== undefined;
  const marked = useRef(false);
  useEffect(() => {
    // Once per visit: later reads of the rows aren't the screen opening.
    if (!ready || marked.current) return;
    const frame = requestAnimationFrame(() => {
      marked.current = true;
      perfMark("songs.rows", "page");
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  const rowState = useMemo(
    () => ({ currentIds, favorites, selection, version }),
    [currentIds, favorites, selection, version],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: number; index: number }) => {
      const song = pages.rowOf(item);
      if (song === undefined) return <LoadingRow />;
      return (
        <SwipeSummaryRow
          summary={song}
          track={{ ...toTrackSummary(song), artist: songRowLine(song.artist) }}
          state={currentIds.has(String(item)) ? "playing" : undefined}
          favorite={favorites.has(item)}
          leading="artwork"
          playDisc
          {...selectableRow(
            item,
            listSelection,
            // A found song plays the whole list from its own place in it.
            () => void playTrackIds(order.ids, missing, placeOf(index), SONGS_CONTEXT),
            (options) => openTrackActionsById(item, options),
          )}
        />
      );
    },
    // `version` re-renders the rows as their pages arrive.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [pages, version, currentIds, favorites, listSelection, order, missing, placeOf],
  );

  const header: ReactElement = (
    <View>
      <ScanProgressBanner />
      {orderError !== undefined && <LibraryReadNote queryKey={orderError} label="song order" />}
      <ListIntroLayout
        line={songCount(order.ids.length)}
        onPlay={() => void playTrackIds(order.ids, missing, undefined, SONGS_CONTEXT)}
        onShuffle={() =>
          void playTrackIds(order.ids, missing, undefined, SONGS_CONTEXT, { shuffle: true })
        }
        sortControl={<SongSortButton kind="songs" />}
      />
    </View>
  );

  return (
    <View className="flex-1">
      <LegendList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={shownIds}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        extraData={rowState}
        estimatedItemSize={grid.row}
        getFixedItemSize={() => grid.row}
        recycleItems
        onViewableItemsChanged={onViewableItemsChanged}
        contentContainerStyle={{
          paddingLeft: grid.margin,
          paddingRight: spine.paddingRight,
          // Lets the last row scroll out from under the floating mini player (or selection bar).
          paddingBottom: bottomInset,
          minHeight: find.minHeight,
        }}
        initialScrollOffset={FIND_FIELD_HEIGHT}
        ListHeaderComponent={
          <View>
            <FindHead find={find} header={header} of="songs" allRead={findTexts !== null} />
            {found !== null && findTexts === null && (
              <LibraryReadNote queryKey="songFindTexts" label="song matches" />
            )}
          </View>
        }
      />
      {spine.show && found === null && (
        <AlphabetSpine entries={spine.entries} onJump={spine.onJump} topRow={spine.topRow} />
      )}
    </View>
  );
}
