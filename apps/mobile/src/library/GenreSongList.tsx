import { type LegendListRef } from "@legendapp/list/react-native";
import type { IndexEntry, LibrarySongSort } from "@wave/core";
import * as Effect from "effect/Effect";
import { useScrollToTop } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";

import { SongList } from "@/songs/SongList";
import { summarySongEntry } from "@/songs/songListSources";
import { openTrackActionsById } from "@/playback/ActionsMenu";
import { runSummarySwipe } from "@/playback/rowSwipe";
import { grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { freeTurnEffect, settledTurnEffect } from "@/lib/backgroundWork";
import { useListScrollable } from "@/motion/heldTouch";
import { useRenderCount } from "@/perf/perf";
import { playTrackIds } from "@/playback/actions";
import type { ActionItems } from "@/playback/actionTargets";

import { useListSelection } from "@/selection/useListSelection";

import {
  createGenreOrderActions,
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
import { songIdKey, useRowsNearScreen } from "./pagedSongRows";
import { appRuntime } from "./runtime";
import { libraryQuery, useLibraryQuery, type LibraryQuery } from "./sharedQueries";
import { SongSortButton } from "./SongSortButton";
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
 * first page), and `current` for the load's own whole order once it's read.
 * Openings in one revision of the genre's order share one load.
 */
const useWholeOrder = (
  genreId: number,
  sort: LibrarySongSort,
  opening: GenreOpening | undefined,
): {
  readonly load: GenreOrderLoad | null;
  readonly shown: SongOrder | null;
  readonly current: SongOrder | null;
} => {
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
  return { load, shown: whole ?? (last?.sorted === sorted ? last.order : null), current: whole };
};

const NO_IDS: readonly number[] = [];
const NO_SUMMARIES: readonly SongSummary[] = [];
const NO_ROWS: ReadonlyMap<number, SongRow> = new Map();
const NO_SPINE: readonly IndexEntry[] = [];

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
  const context = useMemo(() => ({ kind: "genre", id: String(genre.id) }) as const, [genre.id]);

  const { load, shown: whole, current } = useWholeOrder(genre.id, sort, opening);
  const ids = whole?.ids ?? opening?.order.ids ?? NO_IDS;
  const { pages, version } = usePagedSongs(ids, opening?.songs ?? NO_SUMMARIES);
  const spine = useSpineEntries(whole?.spine ?? NO_SPINE, list);

  // Play, Shuffle and taps wait for the opening (a press on the known header)
  // and then for the whole order, which they read at once if it hasn't arrived;
  // when the genre's order changes first, they play the new one.
  const [orders] = useState(createGenreOrderActions);
  useEffect(() => {
    orders.open(true);
    return () => orders.open(false);
  }, [orders]);
  useEffect(() => orders.show(load), [orders, load]);
  const play = useCallback(
    (from: number | undefined, options?: { readonly shuffle?: boolean }) => {
      void orders.whole().then((order) => {
        if (order === null) return;
        // By id: the whole order may have been read again since the row was drawn.
        const start = from === undefined ? undefined : order.ids.indexOf(from);
        if (start === -1) return;
        return playTrackIds(order.ids, new Set(order.missing), start, context, options);
      });
    },
    [orders, context],
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
      if (current === null) return null;
      const items: { song: SongRow }[] = [];
      for (const id of selected) {
        const song = full.get(id);
        if (song === undefined) return null;
        items.push({ song });
      }
      return { kind: "track", items };
    },
    [full, current],
  );
  const listSelection = useListSelection({ items: ids, keyOf: songIdKey, target });
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
  const { nearScreen, onViewableItemsChanged } = useRowsNearScreen(ids, pages, selection, want);
  useEffect(() => {
    if (selection === null) {
      for (const controller of rowReads.current) controller.abort();
      rowReads.current.clear();
      generation.current++;
      asked.current.clear();
      setFull(NO_ROWS);
      return;
    }
    void load?.whole();
    want([...selection.keys].map(Number));
    want(nearScreen());
  }, [selection, load, want, nearScreen, opening]);

  const source = useCallback((id: number) => summarySongEntry(id, pages.rowOf(id)), [pages]);

  return (
    <View className="flex-1">
      <SongList
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={ids}
        keyExtractor={songIdKey}
        song={source}
        extraData={version}
        context={context}
        selection={selectable}
        onPlay={(id) => play(id)}
        onMenu={(id, options) => openTrackActionsById(id, options)}
        onSongSwipe={(id, side) => runSummarySwipe(id, side)}
        spine={spine}
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
    </View>
  );
}
