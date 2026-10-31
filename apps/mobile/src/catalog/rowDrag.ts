import { reorderScrollSpeed, reorderShift, reorderTarget } from "@wave/core";
import * as Haptics from "expo-haptics";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { usePanGesture } from "react-native-gesture-handler";
import {
  Easing,
  scrollTo,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";

import { grid } from "@/catalog/grid";
import { liftedTop } from "@/catalog/liftedRow";
import { useListScroll } from "@/lib/useListScroll";
import { handleHold } from "@/motion/handleHold";
import { perfCount } from "@/perf/perf";

/**
 * Dragging a row of a recycled list by its handle (Up Next, a playlist's
 * songs), on the UI thread.
 *
 * The finger, the lifted row, the rows stepping aside and the edge auto-scroll
 * all run there, so they keep up while JavaScript is busy (an import, a
 * render). JavaScript hears only what it acts on: a drag starting (the lifted
 * copy, a haptic), the drop target changing (a haptic) and the drop landing
 * (the move). Each is one call, not one per movement.
 */

export const ROW = grid.row;

/** Distance from the list's top or bottom edge where a dragged row starts scrolling it, in dp. */
const AUTOSCROLL_EDGE = ROW;
/** Auto-scroll speed at the very edge, in dp per second. */
const AUTOSCROLL_SPEED = ROW * 12;

const EASE_OUT = Easing.out(Easing.exp);
/** Rows stepping aside. Like every `withTiming`, it jumps under the system's reduce-motion setting. */
const STEP_ASIDE = { duration: 160, easing: EASE_OUT };
/** The dropped row settling into its slot. */
const SETTLE = { duration: 120, easing: EASE_OUT };

/** The live drag, on the UI thread. */
type Session = {
  readonly key: string;
  /** The row's index when the drag started: the finger's travel is counted from its slot. */
  readonly start: number;
  readonly startScroll: number;
  /** The finger's translation when the drag started (later than the touch when it waited for a drop to land). */
  readonly base: number;
  /** The dragged entry's index in the list on screen; moves if the queue changes under the drag. */
  readonly from: number;
  /** Where it would land if dropped now. */
  readonly to: number;
};

/**
 * What the rows stand aside for. Live while a drag or its drop is on screen:
 * rows glide to their places. At rest (`from` -1) once a drop has landed and
 * its new order rendered. In between, JavaScript places them for the new order.
 */
type Aside = { readonly from: number; readonly to: number; readonly live: boolean };

const AT_REST: Aside = { from: -1, to: -1, live: false };

/** Marks a drop as landing: JavaScript places the rows for the new order from here. */
const settle = (aside: SharedValue<Aside>): void => {
  "worklet";
  const current = aside.get();
  if (current.live) aside.set({ ...current, live: false });
};

/** Ends a drop: the next drag can start. */
const rest = (aside: SharedValue<Aside>, lifted: SharedValue<string | null>): void => {
  "worklet";
  aside.set(AT_REST);
  lifted.set(null);
};

/** Drops a live drag on the spot, with no move and no settling: the list went out of sight. */
const cancelDrag = (
  session: SharedValue<Session | null>,
  aside: SharedValue<Aside>,
  lifted: SharedValue<string | null>,
  waiting: SharedValue<string | null>,
  translation: SharedValue<number>,
): void => {
  "worklet";
  waiting.set(null);
  if (session.get() === null) return;
  session.set(null);
  translation.set(0);
  rest(aside, lifted);
};

/** The dragged row, for the lifted copy and the rows' looks (a re-render on start and on landing). */
type Drag = { readonly key: string };

/** What a row needs to be dragged and to step aside. */
export type DragRows = {
  readonly session: SharedValue<Session | null>;
  readonly aside: SharedValue<Aside>;
  readonly lifted: SharedValue<string | null>;
  readonly liftedY: SharedValue<number>;
  readonly translation: SharedValue<number>;
  readonly waiting: SharedValue<string | null>;
  readonly begin: (key: string, index: number, base: number) => void;
  readonly move: (translationY: number) => void;
  readonly drop: (canceled: boolean) => void;
  readonly retarget: () => void;
  /** Hands the list a mounted row's offset, so a landing drop can reset it; returns the call that lets it go. */
  readonly trackOffset: (offset: SharedValue<number>) => () => void;
};

/**
 * The list's side of the drag. [keys] are the draggable rows' keys in order;
 * [onDrop] hears a drop that moved one (its key, from, to). The first of them
 * starts [lead] into the list's content (a head, or History and the sticky
 * bar above Up Next), and a bar [bar] tall stays over the list's top while
 * the rows scroll under it. [keepLifted] keeps the lifted row inside the
 * list, below the bar or the first row's slot (Up Next); otherwise it follows
 * the finger over the head. Auto-scroll goes no higher than [scrollFloor]
 * (the list's own scroll) and the list opens at [initialScroll]. [counter]
 * names the perf counters (`<counter>.start`, `.target`, `.end`).
 */
export function useRowDrag({
  keys,
  bottomInset,
  lead,
  bar = 0,
  keepLifted = false,
  scrollFloor,
  initialScroll,
  counter,
  onDrop: dropped,
}: {
  keys: readonly string[];
  bottomInset: number;
  lead: number;
  bar?: number;
  keepLifted?: boolean;
  scrollFloor: number;
  initialScroll: number;
  counter: string;
  onDrop: (key: string, from: number, to: number) => void;
}) {
  // The list's scroll, and the rows' (counted from the first row), which the drag works in.
  const { scrollRef, scroll: listScroll } = useListScroll(initialScroll);
  const leadAt = useSharedValue(lead);
  const floorAt = useSharedValue(scrollFloor);
  const height = useSharedValue(0);
  const count = useSharedValue(keys.length);
  const extent = useSharedValue(keys.length * ROW + bottomInset);
  useLayoutEffect(() => {
    count.set(keys.length);
    extent.set(keys.length * ROW + bottomInset);
    leadAt.set(lead);
    floorAt.set(scrollFloor);
  }, [count, extent, leadAt, floorAt, keys.length, bottomInset, lead, scrollFloor]);
  const scrolled = useCallback(() => {
    "worklet";
    return listScroll.get() - leadAt.get();
  }, [listScroll, leadAt]);
  // The top of the list a lifted row stays under: the bar, or Up Next's first slot below it.
  const floor = useCallback(() => {
    "worklet";
    return keepLifted ? Math.max(bar, -scrolled()) : null;
  }, [keepLifted, bar, scrolled]);

  const session = useSharedValue<Session | null>(null);
  const aside = useSharedValue<Aside>(AT_REST);
  // The finger's travel since the drag started; animates the drop into its slot.
  const translation = useSharedValue(0);
  // The lifted row's top on screen when the drag started.
  const anchor = useSharedValue(0);
  // The row a drag lifted, from the start until its drop has landed, and its
  // top in the list's content (the row follows the finger itself until
  // JavaScript has drawn the lifted copy over it).
  const lifted = useSharedValue<string | null>(null);
  const liftedY = useSharedValue(0);
  // A handle touched while a drop was landing: its drag starts once it has.
  const waiting = useSharedValue<string | null>(null);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Mounted rows' offsets.
  const rows = useRef(new Set<SharedValue<number>>());
  // True from a drop landing until the list has rendered its new order.
  const landing = useRef(false);
  const keysNow = useRef(keys);
  const droppedNow = useRef(dropped);
  useLayoutEffect(() => {
    keysNow.current = keys;
    droppedNow.current = dropped;
  });

  const onTarget = useCallback(() => {
    perfCount(`${counter}.target`);
    void Haptics.selectionAsync();
  }, [counter]);

  const onDrop = useCallback(
    (key: string, from: number, to: number) => {
      perfCount(`${counter}.end`);
      scheduleOnUI(settle, aside);
      landing.current = true;
      setDrag(null);
      rerender();
      if (to !== from) droppedNow.current(key, from, to);
    },
    [aside, counter],
  );

  const drop = useCallback(
    (canceled: boolean) => {
      "worklet";
      const current = session.get();
      if (current === null) return;
      session.set(null);
      const { key, from } = current;
      const to = canceled ? from : current.to;
      if (to !== current.to) aside.set({ from, to, live: true });
      // The lifted row settles into the gap it was dropped on, then the drop lands.
      const slot = to * ROW;
      liftedY.set(withTiming(slot, SETTLE));
      translation.set(
        withTiming(slot - scrolled() - anchor.get(), SETTLE, () => {
          scheduleOnRN(onDrop, key, from, to);
        }),
      );
    },
    [session, aside, liftedY, translation, scrolled, anchor, onDrop],
  );

  // The dragged row left the list (it started playing, or was removed): its drag ends where it began.
  const abandon = useCallback(
    (key: string) => {
      scheduleOnUI(() => {
        "worklet";
        if (session.get()?.key === key) drop(true);
      });
    },
    [session, drop],
  );

  const onBegin = useCallback(
    (key: string) => {
      perfCount(`${counter}.start`);
      if (!keysNow.current.includes(key)) {
        abandon(key);
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDrag({ key });
    },
    [abandon, counter],
  );

  const follow = useCallback(() => {
    "worklet";
    liftedY.set(
      liftedTop(anchor.get() + translation.get(), height.get(), floor(), ROW) + scrolled(),
    );
  }, [liftedY, anchor, translation, height, scrolled, floor]);

  const retarget = useCallback(() => {
    "worklet";
    const current = session.get();
    if (current === null) return;
    const to = reorderTarget({
      from: current.start,
      distance: translation.get() + scrolled() - current.startScroll,
      rowHeight: ROW,
      count: count.get(),
    });
    if (to === current.to) return;
    session.set({ ...current, to });
    aside.set({ from: current.from, to, live: true });
    scheduleOnRN(onTarget);
  }, [session, translation, scrolled, count, aside, onTarget]);

  const begin = useCallback(
    (key: string, index: number, base: number) => {
      "worklet";
      const at = scrolled();
      session.set({ key, start: index, startScroll: at, base, from: index, to: index });
      aside.set({ from: index, to: index, live: true });
      translation.set(0);
      anchor.set(index * ROW - at);
      lifted.set(key);
      liftedY.set(index * ROW);
      waiting.set(null);
      scheduleOnRN(onBegin, key);
    },
    [scrolled, session, aside, translation, anchor, lifted, liftedY, waiting, onBegin],
  );

  const move = useCallback(
    (translationY: number) => {
      "worklet";
      const current = session.get();
      if (current === null) return;
      translation.set(translationY - current.base);
      follow();
      retarget();
    },
    [session, translation, follow, retarget],
  );

  // Near the list's top or bottom edge the lifted row scrolls it, faster the further in.
  const autoscroll = useFrameCallback((frame) => {
    if (session.get() === null) return;
    // Counted below the sticky bar, which covers the list's top edge.
    const speed = reorderScrollSpeed({
      top: anchor.get() + translation.get() - bar,
      rowHeight: ROW,
      viewport: height.get() - bar,
      edge: AUTOSCROLL_EDGE,
      maxSpeed: AUTOSCROLL_SPEED,
    });
    if (speed === 0) return;
    const seconds = (frame.timeSincePreviousFrame ?? 0) / 1000;
    const max = Math.max(0, extent.get() - height.get());
    const now = scrolled();
    // It scrolls no higher than its floor (the start of Up Next: History stays out of sight).
    const lowest = floorAt.get() - leadAt.get();
    const next = Math.min(max, Math.max(Math.min(lowest, now), now + speed * seconds));
    if (next === now) return;
    scrollTo(scrollRef, 0, next + leadAt.get(), false);
    listScroll.set(next + leadAt.get());
    follow();
    retarget();
  }, false);
  // Only while a row is lifted, so an idle Queue doesn't run a callback every frame.
  useEffect(() => {
    autoscroll.setActive(drag !== null);
  }, [autoscroll, drag]);

  // A queue that grew or shrank under the drag moves where the row would land.
  useAnimatedReaction(
    () => count.get(),
    (now, before) => {
      if (before !== null && now !== before) retarget();
    },
  );

  // After the render a drop landed in, every row is in its place for the new
  // order: offsets reset, and the next drag can start.
  useLayoutEffect(() => {
    if (!landing.current) return;
    landing.current = false;
    for (const offset of rows.current) offset.set(0);
    scheduleOnUI(rest, aside, lifted);
  });

  // The dragged row left the list under the drag.
  useLayoutEffect(() => {
    if (drag !== null && !keys.includes(drag.key)) abandon(drag.key);
  }, [drag, keys, abandon]);

  // The list went out of sight under a drag (the Queue's player view or a
  // closing sheet took over; hidden, its effects and gestures are torn down):
  // the drag ends where it began, with no move, and the list shows again at rest.
  useLayoutEffect(
    () => () => {
      scheduleOnUI(cancelDrag, session, aside, lifted, waiting, translation);
      setDrag(null);
    },
    [session, aside, lifted, waiting, translation],
  );

  const trackOffset = useCallback((offset: SharedValue<number>) => {
    const tracked = rows.current;
    tracked.add(offset);
    return () => {
      tracked.delete(offset);
    };
  }, []);

  const rowDrag = useMemo<DragRows>(
    () => ({
      session,
      aside,
      lifted,
      liftedY,
      translation,
      waiting,
      begin,
      move,
      drop,
      retarget,
      trackOffset,
    }),
    [
      session,
      aside,
      lifted,
      liftedY,
      translation,
      waiting,
      begin,
      move,
      drop,
      retarget,
      trackOffset,
    ],
  );

  // The lifted copy, drawn over the list once JavaScript knows the drag.
  const liftedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: liftedTop(anchor.get() + translation.get(), height.get(), floor(), ROW) },
    ],
  }));

  return {
    drag,
    rowDrag,
    liftedStyle,
    height,
    scroll: listScroll,
    scrollRef,
  };
}

/**
 * A row's side: its handle's pan (off while [enabled] is false), and its offset (stepping aside, or
 * following the finger while it's the lifted row).
 */
export function useDraggedRow(rowDrag: DragRows, key: string, index: number, enabled = true) {
  const { session, aside, lifted, liftedY, waiting, begin, move, drop, retarget, trackOffset } =
    rowDrag;
  const offset = useSharedValue(0);
  const rowIndex = useSharedValue(index);
  useLayoutEffect(() => trackOffset(offset), [trackOffset, offset]);

  // A new index lands with the offset it calls for, in one step on the UI thread.
  useLayoutEffect(() => {
    scheduleOnUI(() => {
      "worklet";
      rowIndex.set(index);
      const current = aside.get();
      offset.set(
        current.live ? reorderShift({ index, from: current.from, to: current.to }) * ROW : 0,
      );
    });
  }, [rowIndex, aside, offset, index]);

  // Rows glide aside as the drop target moves.
  useAnimatedReaction(
    () => {
      const current = aside.get();
      return current.live
        ? reorderShift({ index: rowIndex.get(), from: current.from, to: current.to })
        : null;
    },
    (shift, before) => {
      if (shift === null || shift === before) return;
      offset.set(withTiming(shift * ROW, STEP_ASIDE));
    },
  );

  // The dragged row's place in the list moved (the queue changed under the
  // drag): the gap it leaves moves with it.
  useAnimatedReaction(
    () => rowIndex.get(),
    (now, before) => {
      const current = session.get();
      if (before === null || current === null || current.key !== key || current.from === now) {
        return;
      }
      session.set({ ...current, from: now });
      aside.set({ from: now, to: current.to, live: true });
      retarget();
    },
  );

  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: lifted.get() === key ? liftedY.get() - rowIndex.get() * ROW : offset.get(),
      },
    ],
  }));

  const pan = usePanGesture(
    useMemo(
      () => ({
        activateAfterLongPress: handleHold.activateAfterLongPress,
        minDistance: handleHold.minDistance,
        enabled,
        onActivate: (event: { translationY: number }) => {
          "worklet";
          // A drop still landing has the old order's indices: wait for the new one.
          if (aside.get().from !== -1) {
            waiting.set(key);
            return;
          }
          begin(key, rowIndex.get(), event.translationY);
        },
        onUpdate: (event: { translationY: number }) => {
          "worklet";
          const current = session.get();
          if (current?.key === key) {
            move(event.translationY);
          } else if (waiting.get() === key && aside.get().from === -1) {
            begin(key, rowIndex.get(), event.translationY);
          }
        },
        onFinalize: (event: { canceled: boolean }) => {
          "worklet";
          if (waiting.get() === key) waiting.set(null);
          if (session.get()?.key === key) drop(event.canceled);
        },
      }),
      [enabled, aside, waiting, begin, session, move, drop, key, rowIndex],
    ),
  );

  return { pan, style };
}
