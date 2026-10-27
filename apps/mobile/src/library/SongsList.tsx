import { useScreenContent } from "@/lib/screenTiming";
import { type LegendListRef } from "@legendapp/list/react-native";
import { IconMusic } from "@tabler/icons-react-native";
import { hasFindQuery, librarySongSort } from "@wave/core";
import { useScrollToTop } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { View } from "react-native";

import { SongList } from "@/songs/SongList";
import { summarySongEntry } from "@/songs/songListSources";
import { openTrackActionsById } from "@/playback/ActionsMenu";
import { runSummarySwipe } from "@/playback/rowSwipe";
import { grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { TextButton } from "@/components/TextButton";
import { useListScrollable } from "@/motion/heldTouch";
import { perfMark, useRenderCount } from "@/perf/perf";
import { playTrackIds } from "@/playback/actions";
import type { ActionItems } from "@/playback/actionTargets";

import { useListSelection } from "@/selection/useListSelection";

import { FIND_FIELD_HEIGHT, FindHead, useFindInLegendList } from "./FindInPlaylist";
import { folderPhrase } from "./folderPhrase";
import { useScanRoots, useScanStatus } from "./hooks";
import type { SongOrder, SongRow } from "./LibraryStore";
import { LibraryReadFeedback, LibraryReadNote } from "./LibraryReadFeedback";
import { songOrderQueryKey, usePagedSongs, useSongFindTexts, useSongOrder } from "./pagedSongs";
import { songIdKey, useRowsNearScreen } from "./pagedSongRows";
import { promptForMusicFolder } from "./promptForMusicFolder";
import { songsWithIds } from "./sectionSongs";
import { SongSortButton } from "./SongSortButton";
import { libraryQueryState } from "./sharedQueries";
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
  const scanStatus = useScanStatus();
  const roots = useScanRoots();

  if (order === null)
    return <LibraryReadFeedback queryKey={songOrderQueryKey(sort)} label="songs" scan />;

  if (order.ids.length === 0) {
    return (
      <View style={{ paddingHorizontal: grid.margin }}>
        <ScanProgressBanner />
        <EmptyState
          icon={IconMusic}
          title={scanStatus === "scanning" ? "Looking for songs" : "No songs"}
          message={
            scanStatus === "scanning"
              ? "Songs appear here as Wave finds them."
              : `Wave didn't find any songs in ${folderPhrase(roots)}.`
          }
          action={
            scanStatus === "scanning" ? undefined : (
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

const NO_ROWS: ReadonlyMap<number, SongRow> = new Map();

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
  // Find in Songs: what finds each song is read once a query is first typed.
  const [findWanted, setFindWanted] = useState(false);
  const findTexts = useSongFindTexts(findWanted);
  const describe = useCallback((id: number) => findTexts?.get(id) ?? null, [findTexts]);
  const find = useFindInLegendList(list, order.ids, describe, true);
  if (!findWanted && hasFindQuery(find.query)) setFindWanted(true);
  const { found, shown: shownIds } = find;
  const { pages, version } = usePagedSongs(shownIds);
  useScreenContent(shownIds.length === 0 || pages.row(0) !== undefined || version > 0);
  const missing = useMemo(() => new Set(order.missing), [order]);
  const spine = useSpineEntries(order.spine, list);

  // Selecting: the checked songs' full rows (what the actions need), and those
  // near the screen, read as they're needed and dropped when selecting ends.
  const [full, setFull] = useState(NO_ROWS);
  const asked = useRef(new Set<number>());
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
  const listSelection = useListSelection({ items: order.ids, keyOf: songIdKey, target });
  const { selection } = listSelection;
  const { nearScreen, onViewableItemsChanged } = useRowsNearScreen(
    shownIds,
    pages,
    selection,
    want,
  );
  useEffect(() => {
    if (selection === null) {
      asked.current.clear();
      return;
    }
    want([...selection.keys].map(Number));
    want(nearScreen());
  }, [selection, want, nearScreen]);

  if (selection === null && full !== NO_ROWS) setFull(NO_ROWS);

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

  const source = useCallback((id: number) => summarySongEntry(id, pages.rowOf(id)), [pages]);

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
      <SongList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={shownIds}
        keyExtractor={songIdKey}
        song={source}
        extraData={version}
        context={SONGS_CONTEXT}
        selection={listSelection}
        onPlay={(id) => void playTrackIds(order.ids, missing, order.ids.indexOf(id), SONGS_CONTEXT)}
        onMenu={(id, options) => openTrackActionsById(id, options)}
        onSongSwipe={(id, side) => runSummarySwipe(id, side)}
        spine={found === null ? spine : undefined}
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
    </View>
  );
}
