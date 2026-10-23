import {
  LegendList,
  type LegendListRef,
  type OnViewableItemsChangedInfo,
} from "@legendapp/list/react-native";
import {
  PAGED_ROWS_LIMITS,
  showsExplicitBadge,
  type IndexEntry,
  type LibrarySongSort,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useScrollToTop } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { songRowLine } from "@/catalog/cards/SongCard";
import { CELL, grid } from "@/catalog/grid";
import type { TrackSummary } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { fileUri } from "@/lib/fileUri";
import { freeTurnEffect, settledTurnEffect } from "@/lib/backgroundWork";
import { useListScrollable } from "@/motion/heldTouch";
import { useRenderCount } from "@/perf/perf";
import { playTrackIds } from "@/playback/actions";
import { openTrackActionsById } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/actionTargets";
import { useCurrentPlayingIds } from "@/playback/hooks";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection } from "@/selection/useListSelection";

import { useFavoriteIds } from "./favorites";
import {
  createGenreOrderLoad,
  readGenreOrder,
  readGenreSongs,
  type GenreOrderLoad,
} from "./genreOrder";
import {
  LibraryStore,
  type GenreOpening,
  type GenreRow,
  type SongOrder,
  type SongRow,
  type SongSummary,
} from "./LibraryStore";
import { usePagedSongs } from "./pagedSongs";
import { appRuntime } from "./runtime";
import { libraryQuery, useLibraryQuery, type LibraryQuery } from "./sharedQueries";
import { SongSortButton } from "./SongSortButton";
import { SwipeSummaryRow } from "./SwipeTrackRow";
import { ListIntroLayout, songCount } from "./TrackList";
import { useSpineEntries } from "./useSpine";

/**
 * What genre [id]'s screen opens on in [sort] (#601): its header and first
 * page, one shared query per genre and sort, read again as the tracks change.
 * Undefined until read; null once the genre is gone.
 */
export const useGenreOpening = (
  id: number,
  sort: LibrarySongSort,
): GenreOpening | null | undefined => {
  const key = `genreOpening:${id}:${sort.key}:${sort.descending ? "desc" : "asc"}`;
  const query = useMemo(
    (): LibraryQuery<GenreOpening | null> =>
      libraryQuery(
        key,
        { tracks: true },
        // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
        LibraryStore.use((store) => store.openGenre(id, sort)),
      ),
    // The key holds the id and the sort.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return useLibraryQuery<GenreOpening | null | undefined>(query, undefined);
};

/** Runs the order's slices, interrupted when [signal] aborts. */
const runAborting = <A, E>(effect: Effect.Effect<A, E, LibraryStore>, signal: AbortSignal) =>
  appRuntime.runPromise(effect, { signal });

/**
 * [opening]'s whole order, read in slices once the screen settles
 * (`createGenreOrderLoad`): `load` for what acts on it, `shown` for the list,
 * which keeps the last whole order of the genre in its sort until the next
 * one arrives (a scan moves a few songs; the list doesn't fall back to its
 * first page). Openings in one revision of the genre's order share one load.
 */
const useWholeOrder = (
  genreId: number,
  sort: LibrarySongSort,
  opening: GenreOpening | undefined,
): { readonly load: GenreOrderLoad | null; readonly shown: SongOrder | null } => {
  const sorted = `${genreId}:${sort.key}:${sort.descending ? "desc" : "asc"}`;
  const key = opening === undefined ? null : `${sorted}:${opening.revision}`;
  const load = useMemo(
    () =>
      opening === undefined
        ? null
        : createGenreOrderLoad({
            // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
            read: LibraryStore.use((store) =>
              readGenreOrder(store, genreId, sort, opening.order, freeTurnEffect),
            ),
            settled: settledTurnEffect,
            run: runAborting,
          }),
    // The key holds the genre, the sort and the order's revision: a later opening
    // in the same revision has the same order, so its load goes on.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(() => {
    load?.inBackground();
    return () => load?.dispose();
  }, [load]);
  const subscribe = useCallback(
    (onChange: () => void) => load?.subscribe(onChange) ?? (() => {}),
    [load],
  );
  const whole = useSyncExternalStore(subscribe, () => load?.current() ?? null);
  const [last, setLast] = useState<{ readonly sorted: string; readonly order: SongOrder } | null>(
    null,
  );
  if (whole !== null && whole !== last?.order) setLast({ sorted, order: whole });
  return { load, shown: whole ?? (last?.sorted === sorted ? last.order : null) };
};

/** A row as `TrackRow` draws it, as a song card: "Song · " before the artist. */
const toTrackSummary = (song: SongSummary): TrackSummary => ({
  id: String(song.id),
  title: song.title,
  artist: songRowLine(song.artist),
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

const NO_IDS: readonly number[] = [];
const NO_SUMMARIES: readonly SongSummary[] = [];
const NO_ROWS: ReadonlyMap<number, SongRow> = new Map();
const NO_SPINE: readonly IndexEntry[] = [];

/** Rows read past the screen each way while selecting, so checking one acts at once. */
const SELECTING_AHEAD = PAGED_ROWS_LIMITS.pageSize;

/**
 * A genre's songs (#601): the header from the list that opened it, then the
 * first page from one index seek, then the rest of the genre's order (ids
 * only) a slice a turn once the screen has settled; rows are read a page at a
 * time around the screen, as Songs reads them. Play, Shuffle, taps and
 * selections act on the whole genre, reading its order at once if it hasn't
 * arrived yet. [opening] is undefined while it's read.
 */
export function GenreSongList({
  genre,
  opening,
  sort,
}: {
  genre: GenreRow;
  opening: GenreOpening | undefined;
  sort: LibrarySongSort;
}) {
  useRenderCount("GenreSongList");
  const scrollable = useListScrollable();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const bottomInset = useChromeInset();
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  const context = useMemo(() => ({ kind: "genre", id: String(genre.id) }) as const, [genre.id]);

  const { load, shown: whole } = useWholeOrder(genre.id, sort, opening);
  const ids = whole?.ids ?? opening?.order.ids ?? NO_IDS;
  const { pages, version } = usePagedSongs(ids, opening?.songs ?? NO_SUMMARIES);
  const spine = useSpineEntries(whole?.spine ?? NO_SPINE, list);

  // Play, Shuffle and taps wait for the opening (a press on the known header)
  // and then for the whole order, which they read at once if it hasn't arrived.
  const loadRef = useRef(load);
  const active = useRef(true);
  const waiters = useRef<((load: GenreOrderLoad | null) => void)[]>([]);
  useEffect(() => {
    const pending = waiters.current;
    active.current = true;
    return () => {
      active.current = false;
      for (const waiter of pending.splice(0)) waiter(null);
    };
  }, []);
  useEffect(() => {
    loadRef.current = load;
    if (load === null) return;
    for (const waiter of waiters.current.splice(0)) waiter(load);
  }, [load]);
  const play = useCallback(
    (from: number | undefined, options?: { readonly shuffle?: boolean }) => {
      const loaded = loadRef.current;
      const ready =
        loaded !== null
          ? Promise.resolve(loaded)
          : new Promise<GenreOrderLoad | null>((resolve) => waiters.current.push(resolve));
      void ready
        .then((orderLoad) => orderLoad?.whole() ?? null)
        .then((order) => {
          if (order === null || !active.current) return;
          // By id: the whole order may have been read again since the row was drawn.
          const start = from === undefined ? undefined : order.ids.indexOf(from);
          if (start === -1) return;
          return playTrackIds(order.ids, new Set(order.missing), start, context, options);
        });
    },
    [context],
  );

  // Selecting: the whole order first (Select All checks the whole genre), then
  // the checked songs' full rows and those near the screen, as they're needed.
  const [full, setFull] = useState(NO_ROWS);
  const asked = useRef(new Set<number>());
  const rowReads = useRef(new Set<AbortController>());
  const generation = useRef(0);
  useEffect(() => {
    const controllers = rowReads.current;
    generation.current++;
    asked.current.clear();
    setFull(NO_ROWS);
    return () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [opening]);
  const shown = useRef({ start: 0, end: PAGED_ROWS_LIMITS.pageSize });
  const want = useCallback((wantedIds: readonly number[]) => {
    const wanted = wantedIds.filter((id) => !asked.current.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) asked.current.add(id);
    const requested = generation.current;
    const controller = new AbortController();
    rowReads.current.add(controller);
    runAborting(
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use is not a React Hook.
      LibraryStore.use((store) => readGenreSongs(store, wanted, freeTurnEffect)),
      controller.signal,
    ).then(
      (rows) => {
        rowReads.current.delete(controller);
        if (rows.length === 0 || controller.signal.aborted || requested !== generation.current)
          return;
        setFull((before) => {
          const next = new Map(before);
          for (const row of rows) next.set(row.id, row);
          return next;
        });
      },
      () => {
        rowReads.current.delete(controller);
        if (controller.signal.aborted || requested !== generation.current) return;
        for (const id of wanted) asked.current.delete(id);
      },
    );
  }, []);
  // Every checked song, in the list's order, once the whole order and all their rows are read.
  const target = useCallback(
    (selected: readonly number[]): ActionItems | null => {
      // Not before the genre's whole order is read: Select All checks every song in it.
      if (load?.current() == null) return null;
      const items: { song: SongRow }[] = [];
      for (const id of selected) {
        const song = full.get(id);
        if (song === undefined) return null;
        items.push({ song });
      }
      return { kind: "track", items };
    },
    // `whole` re-makes it as the whole order arrives.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [full, load, whole],
  );
  const listSelection = useListSelection({ items: ids, keyOf: keyExtractor, target });
  // Do not expose a partial selection source: Select All must see the complete genre.
  const [pendingSelect, setPendingSelect] = useState<number | null>(null);
  useEffect(() => {
    if (pendingSelect === null) return;
    if (load?.current() == null) {
      void load?.whole();
      return;
    }
    listSelection.start(pendingSelect);
    setPendingSelect(null);
  }, [pendingSelect, load, whole, listSelection]);
  const selectable = useMemo(
    () => ({
      ...listSelection,
      start: (id: number) => {
        if (load?.current() != null) listSelection.start(id);
        else {
          setPendingSelect(id);
          void load?.whole();
        }
      },
    }),
    [listSelection, load],
  );
  const { selection } = listSelection;
  const nearScreen = useCallback(
    () =>
      ids.slice(
        Math.max(0, shown.current.start - SELECTING_AHEAD),
        shown.current.end + SELECTING_AHEAD,
      ),
    [ids],
  );
  useEffect(() => {
    if (selection === null) {
      asked.current.clear();
      setFull(NO_ROWS);
      return;
    }
    void load?.whole();
    want([...selection.keys].map(Number));
    want(nearScreen());
  }, [selection, load, want, nearScreen, opening]);

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

  const rowState = useMemo(
    () => ({ currentIds, favorites, selection, version }),
    [currentIds, favorites, selection, version],
  );

  const renderItem = useCallback(
    ({ item }: { item: number }) => {
      const song = pages.rowOf(item);
      if (song === undefined) return <LoadingRow />;
      return (
        <SwipeSummaryRow
          summary={song}
          track={toTrackSummary(song)}
          state={currentIds.has(String(item)) ? "playing" : undefined}
          favorite={favorites.has(item)}
          leading="artwork"
          playDisc
          {...selectableRow(
            item,
            selectable,
            () => play(item),
            (options) => openTrackActionsById(item, options),
          )}
        />
      );
    },
    // `version` re-renders the rows as their pages arrive.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [pages, version, currentIds, favorites, selectable, play],
  );

  return (
    <View className="flex-1">
      <LegendList
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={ids}
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
        }}
        ListHeaderComponent={
          <ListIntroLayout
            line={songCount(opening?.genre.trackCount ?? genre.trackCount)}
            onPlay={() => play(undefined)}
            onShuffle={() => play(undefined, { shuffle: true })}
            sortControl={<SongSortButton kind="genre" />}
          />
        }
      />
      {spine.show && (
        <AlphabetSpine entries={spine.entries} onJump={spine.onJump} topRow={spine.topRow} />
      )}
    </View>
  );
}
