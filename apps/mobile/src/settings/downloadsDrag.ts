import type { LegendListRef } from "@legendapp/list/react-native";
import {
  dropDownload,
  movableGroups,
  reorderScrollSpeed,
  reorderTarget,
  type DownloadDrop,
  type DownloadingList,
  type DownloadListRow,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type RefObject,
} from "react";
import type { ScrollView, View } from "react-native";
import { usePanGesture } from "react-native-gesture-handler";
import {
  scrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useScrollOffset,
  useSharedValue,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { measureRect, type Measurable } from "@/motion/measureRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { moveQueuedDownloads } from "@/ytmusic/YtDownloads";

/**
 * Dragging Settings › Downloads' rows by their handles, in its virtualized
 * list: a waiting song among its group's songs, or a group (its header) among
 * the groups.
 *
 * A lifted copy of the row (a group's header) follows the finger over the
 * list, and the list scrolls near its edges. The row itself stays in place,
 * hidden (a dragged group's songs with it), and mounted however far the list
 * scrolls, so its handle's gesture lives on. What it passes steps aside for
 * it, as the list did before it was virtualized: a dragged song's group's
 * other songs by its height, the other groups (header and songs) by the
 * dragged group's. Only the rows of the dragged song's group, or of the
 * groups, carry an animated style while it's dragged, and only those mounted.
 * What lands is Core's (`dropDownload`).
 */

/** Distance from the list's top or bottom edge where a dragged row starts scrolling it, in dp. */
const AUTOSCROLL_EDGE = grid.row;
/** Auto-scroll speed at the very edge, in dp per second. */
const AUTOSCROLL_SPEED = grid.row * 12;
/**
 * A row's height until the list has measured it or one like it: what the list
 * assumes too (its `estimatedItemSize`), so drag maths and layout agree.
 */
export const DOWNLOAD_ROW_ESTIMATE = CELL * 10;

/** What's being dragged, for rendering: the lifted copy, the hidden row, the rows stepping aside. */
export type DownloadDrag = {
  readonly kind: "song" | "group";
  /** The dragged row's key in the list. */
  readonly key: string;
  /** The group it's in (a song) or is (a group). */
  readonly groupKey: string;
};

/** The drag as JavaScript follows it. */
type Session = {
  readonly drag: DownloadDrag;
  readonly from: number;
  to: number;
  /** Its scope in order: a group's waiting songs' job ids, or the moving groups' keys. */
  readonly ids: readonly string[];
  /** Their heights: a song row's, or a group's header and songs together. */
  readonly heights: readonly number[];
  /** The id at the drop target, resolved again when it lands (the list may change under it). */
  over: string;
};

/** What every draggable row shares. Stable while the list changes. */
export type DownloadRowDrag = {
  /** The dragged row's place in its scope, or -1; where it would land; its height. */
  readonly from: SharedValue<number>;
  readonly to: SharedValue<number>;
  readonly step: SharedValue<number>;
  readonly travel: SharedValue<number>;
  readonly scroll: SharedValue<number>;
  readonly startScroll: SharedValue<number>;
  readonly begin: (target: DownloadDrag, view: Measurable | null) => void;
  readonly dragTo: (distance: number) => void;
  readonly drop: (canceled: boolean) => void;
};

/**
 * Each row's height as [list] measured it, or as it measured rows like it
 * (unmounted rows: most of a long queue), or a guess before it measured any.
 */
const rowHeights = (list: LegendListRef | null) => {
  const state = list?.getState();
  const averages = state?.getAverageItemSizes() ?? {};
  return (row: DownloadListRow): number =>
    state?.sizes.get(row.key) ?? averages[row.kind]?.average ?? DOWNLOAD_ROW_ESTIMATE;
};

/** A dragged song's scope: its group's waiting songs, with their heights. */
const songScope = (
  rows: readonly DownloadListRow<NativeYtSong>[],
  groupKey: string,
  list: LegendListRef | null,
) => {
  const heightOf = rowHeights(list);
  const songs = rows.filter((row) => row.kind === "waiting" && row.groupKey === groupKey);
  return {
    keys: songs.map((row) => row.key),
    ids: songs.map((row) => (row.kind === "waiting" ? row.queued.id : "")),
    heights: songs.map(heightOf),
  };
};

/** A dragged group's scope: the moving groups, each header and songs together, with their heights. */
const groupScope = (rows: readonly DownloadListRow<NativeYtSong>[], list: LegendListRef | null) => {
  const keys: string[] = [];
  const ids: string[] = [];
  const heights: number[] = [];
  const heightOf = rowHeights(list);
  for (const row of rows) {
    if (row.kind === "header") {
      keys.push(row.key);
      ids.push(row.group.key);
      heights.push(heightOf(row));
    } else if (row.kind === "waiting" && heights.length > 0) {
      heights[heights.length - 1]! += heightOf(row);
    }
  }
  return { keys, ids, heights };
};

/**
 * The list's side of the drag over [list]'s [rows], shown by [listRef]: the
 * shared state the rows' handles drive, the lifted copy's style, and the moves
 * screen readers' Move up / Move down make.
 */
export function useDownloadsDrag({
  list,
  rows,
  listRef,
}: {
  list: DownloadingList<NativeYtSong>;
  rows: readonly DownloadListRow<NativeYtSong>[];
  listRef: RefObject<LegendListRef | null>;
}) {
  const scrollRef = useAnimatedRef<ScrollView>();
  const scroll = useScrollOffset(scrollRef);
  const container = useRef<ComponentRef<typeof View>>(null);
  const viewport = useSharedValue(0);
  const content = useSharedValue(0);

  const from = useSharedValue(-1);
  const to = useSharedValue(-1);
  const step = useSharedValue(0);
  const travel = useSharedValue(0);
  const startScroll = useSharedValue(0);
  // The dragged row's top in the list's viewport when it was picked up, and its height.
  const anchor = useSharedValue(0);
  const lifted = useSharedValue(0);

  const [drag, setDrag] = useState<DownloadDrag | null>(null);
  const session = useRef<Session | null>(null);
  const latest = useRef({ list, rows });
  useLayoutEffect(() => {
    latest.current = { list, rows };
  });

  /** Lands [drop] on the list as it is now (Core's `dropDownload`). */
  const land = useCallback((drop: DownloadDrop) => {
    const order = dropDownload(latest.current.list, drop);
    if (order !== null) moveQueuedDownloads(order);
  }, []);
  // Move up / Move down: a row's place in its scope, to the place next to it.
  const moveSong = useCallback(
    (groupKey: string, start: number, end: number) => {
      const group = latest.current.list.groups.find((each) => each.key === groupKey);
      const [from, to] = [group?.queued[start]?.id, group?.queued[end]?.id];
      if (from !== undefined && to !== undefined) land({ kind: "song", groupKey, from, to });
    },
    [land],
  );
  const moveGroup = useCallback(
    (start: number, end: number) => {
      const groups = movableGroups(latest.current.list);
      const [from, to] = [groups[start]?.key, groups[end]?.key];
      if (from !== undefined && to !== undefined) land({ kind: "group", from, to });
    },
    [land],
  );

  const begin = useCallback(
    (target: DownloadDrag, view: Measurable | null) => {
      if (session.current !== null || view === null) return;
      const { rows: shown } = latest.current;
      const scope =
        target.kind === "song"
          ? songScope(shown, target.groupKey, listRef.current)
          : groupScope(shown, listRef.current);
      const index = scope.keys.indexOf(target.key);
      const id = scope.ids[index];
      if (id === undefined) return;
      const started: Session = {
        drag: target,
        from: index,
        to: index,
        ids: scope.ids,
        heights: scope.heights,
        over: id,
      };
      session.current = started;
      content.set(listRef.current?.getState().contentLength ?? 0);
      step.set(scope.heights[index] ?? 0);
      to.set(index);
      from.set(index);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // The lifted copy starts where the row is on screen.
      void Promise.all([measureRect(container.current), measureRect(view)]).then(([box, row]) => {
        if (session.current !== started) return;
        if (box === undefined || row === undefined) {
          // Not laid out: no lifted copy to show, so no drag.
          session.current = null;
          from.set(-1);
          to.set(-1);
          return;
        }
        anchor.set(row.top - box.top);
        lifted.set(row.bottom - row.top);
        setDrag(started.drag);
      });
    },
    [listRef, content, step, to, from, anchor, lifted],
  );

  const dragTo = useCallback(
    (distance: number) => {
      const current = session.current;
      if (current === null) return;
      const count = current.heights.length;
      // A song among its group's songs, a group among the groups: what it passes steps aside.
      const next = reorderTarget({
        from: current.from,
        distance,
        rowHeight: current.heights,
        count,
      });
      content.set(listRef.current?.getState().contentLength ?? content.get());
      if (next === current.to) return;
      current.to = next;
      current.over = current.ids[next] ?? current.over;
      to.set(next);
      void Haptics.selectionAsync();
    },
    [content, listRef, to],
  );

  // Rows drop into place in the same frame the new order renders.
  const resetAfterRender = useRef(false);
  useLayoutEffect(() => {
    if (!resetAfterRender.current) return;
    resetAfterRender.current = false;
    from.set(-1);
    to.set(-1);
    travel.set(0);
  });

  const drop = useCallback(
    (canceled: boolean) => {
      const current = session.current;
      session.current = null;
      resetAfterRender.current = true;
      setDrag(null);
      if (current === null || canceled) return;
      const from = current.ids[current.from] ?? "";
      land(
        current.drag.kind === "song"
          ? { kind: "song", groupKey: current.drag.groupKey, from, to: current.over }
          : { kind: "group", from, to: current.over },
      );
    },
    [land],
  );

  // The dragged row left the list under the drag (its song started, or was cancelled): its
  // handle went with it, so the drag ends where it began.
  useLayoutEffect(() => {
    const current = session.current;
    if (current !== null && !rows.some((row) => row.key === current.drag.key)) drop(true);
  }, [rows, drop]);

  // Near the list's top or bottom edge the lifted row scrolls it, faster the further in.
  const autoscroll = useFrameCallback((frame) => {
    if (from.get() === -1) return;
    const speed = reorderScrollSpeed({
      top: anchor.get() + travel.get(),
      rowHeight: lifted.get(),
      viewport: viewport.get(),
      edge: AUTOSCROLL_EDGE,
      maxSpeed: AUTOSCROLL_SPEED,
    });
    if (speed === 0) return;
    const seconds = (frame.timeSincePreviousFrame ?? 0) / 1000;
    const max = Math.max(0, content.get() - viewport.get());
    const now = scroll.get();
    const next = Math.min(max, Math.max(0, now + speed * seconds));
    if (next === now) return;
    scrollTo(scrollRef, 0, next, false);
    scroll.set(next);
    scheduleOnRN(dragTo, travel.get() + next - startScroll.get());
  }, false);
  // Only while a row is lifted, so an idle page doesn't run a callback every frame.
  useEffect(() => {
    autoscroll.setActive(drag !== null);
  }, [autoscroll, drag]);

  // The page went away under a drag: nothing lands.
  useEffect(
    () => () => {
      session.current = null;
    },
    [],
  );

  // The lifted copy follows the finger, kept inside the list.
  const liftedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: Math.min(
          Math.max(0, viewport.get() - lifted.get()),
          Math.max(0, anchor.get() + travel.get()),
        ),
      },
    ],
  }));

  const rowDrag = useMemo<DownloadRowDrag>(
    () => ({ from, to, step, travel, scroll, startScroll, begin, dragTo, drop }),
    [from, to, step, travel, scroll, startScroll, begin, dragTo, drop],
  );

  return {
    drag,
    rowDrag,
    moveSong,
    moveGroup,
    liftedStyle,
    scrollRef: scrollRef as AnimatedRef<ScrollView> & RefObject<ScrollView | null>,
    container,
    onLayout: (height: number) => viewport.set(height),
  };
}

/**
 * A draggable row's handle gesture: picks up [target] (whose row is [view]),
 * follows the finger, and drops. Built once per row: the row's place is read
 * when it's picked up.
 */
export function useDragGrip(
  rowDrag: DownloadRowDrag,
  target: DownloadDrag,
  view: RefObject<Measurable | null>,
) {
  const { travel, scroll, startScroll, begin, dragTo, drop } = rowDrag;
  const latest = useRef(target);
  useLayoutEffect(() => {
    latest.current = target;
  });
  const pickUp = useCallback(() => begin(latest.current, view.current), [begin, view]);
  return usePanGesture(
    useMemo(
      () => ({
        minDistance: 0,
        onActivate: () => {
          "worklet";
          travel.set(0);
          startScroll.set(scroll.get());
          scheduleOnRN(pickUp);
        },
        onUpdate: (event: { translationY: number }) => {
          "worklet";
          travel.set(event.translationY);
          scheduleOnRN(dragTo, event.translationY + scroll.get() - startScroll.get());
        },
        onDeactivate: (event: { canceled: boolean }) => {
          "worklet";
          scheduleOnRN(drop, event.canceled);
        },
      }),
      [travel, scroll, startScroll, pickUp, dragTo, drop],
    ),
  );
}
