import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { IconMenu2, IconRepeat, IconRepeatOnce, IconX } from "@tabler/icons-react-native";
import {
  currentEntry,
  reorderShift,
  counted,
  reorderTarget,
  upNext,
  upNextMove,
  withPendingMoves,
  type PendingMove,
  type QueueEntry,
  type RepeatMode,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { Press } from "@/motion/Press";
import { usePerfVisible, useRenderCount } from "@/perf/perf";
import {
  cycleRepeat,
  moveQueueEntry,
  playQueueEntry,
  removeQueueEntry,
  toggleShuffle,
} from "@/playback/actions";
import { useQueue } from "@/playback/hooks";
import { queueState } from "@/playback/Queue";
import type { PlaybackState } from "@/playback/Player";
import type { QueueTrack } from "@/playback/queueTracks";
import { useThemeColor } from "@/theme/useThemeColor";

import { useQueueTracks } from "./hooks";
import { useShuffleControl } from "./ShuffleMenu";
import { TrackHeader } from "./TrackHeader";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const ROW = grid.row;
const THUMB = CELL * 5;
const EASE_OUT = Easing.out(Easing.exp);

/** Distance from the list's top or bottom edge where a dragged row starts scrolling it, in dp. */
const AUTOSCROLL_EDGE = ROW;
/** Auto-scroll speed at the very edge, in dp per second. */
const AUTOSCROLL_SPEED = ROW * 12;

const thumbUri = (track: QueueTrack | undefined): string | undefined =>
  track?.thumbPath == null ? undefined : `file://${track.thumbPath}`;

type ToggleProps = {
  icon: ComponentType<IconProps>;
  label: string;
  on: boolean;
  onPress: () => void;
  /** Opens the toggle's card of choices, where it has one. */
  onLongPress?: (() => void) | undefined;
  accessibilityHint?: string | undefined;
};

/** A labelled toggle: teal while it's on, graphite while it's off. */
function Toggle({ icon: Icon, label, on, onPress, onLongPress, accessibilityHint }: ToggleProps) {
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const color = on ? accent : secondary;
  return (
    <Press
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="selection"
      depth={0.04}
      className="flex-1 flex-row items-center justify-center"
      style={{ height: CELL * 6, gap: CELL }}
    >
      <Icon size={20} color={color} strokeWidth={1.5} />
      <Text
        className={`font-sans text-body ${on ? "font-semibold text-accent" : "text-secondary"}`}
      >
        {label}
      </Text>
    </Press>
  );
}

const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Repeat",
  all: "Repeat",
  one: "Repeat One",
};

/**
 * The top of the Queue view: what's playing (small), the shuffle and repeat
 * toggles (a long press on shuffle opens the shuffle card; it reads Smart
 * Shuffle, with its own icon, while that's chosen), then the Up Next heading. Sits in the sheet's drag-to-dismiss area.
 */
export function QueueHeader({ item }: { item: NonNullable<PlaybackState["item"]> }) {
  const queue = useQueue();
  const shuffle = useShuffleControl();
  const count = queue.entries.length - queue.index - 1;
  return (
    <View>
      <TrackHeader item={item} />
      <Hairline />
      <View className="flex-row" style={{ gap: CELL }}>
        <Toggle {...shuffle} on={queue.shuffle} onPress={toggleShuffle} />
        <Toggle
          icon={queue.repeat === "one" ? IconRepeatOnce : IconRepeat}
          label={REPEAT_LABEL[queue.repeat]}
          on={queue.repeat !== "off"}
          onPress={cycleRepeat}
        />
      </View>
      <Hairline />
      <View
        className="flex-row items-center justify-between"
        style={{ paddingTop: CELL * 2, paddingBottom: CELL }}
      >
        <CatalogLine>Up next</CatalogLine>
        {count > 0 && (
          <Text
            className="font-sans text-footnote text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {counted(count, "song")}
          </Text>
        )}
      </View>
    </View>
  );
}

type RowContentProps = {
  track: QueueTrack | undefined;
};

/** Thumbnail, title and artist: the part of an Up Next row that a drag lifts. */
function RowText({ track }: RowContentProps) {
  return (
    <>
      <Artwork uri={thumbUri(track)} size={THUMB} />
      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
          {track?.title ?? " "}
        </Text>
        <Text numberOfLines={1} className="font-sans text-body text-secondary">
          {track?.artist ?? " "}
        </Text>
      </View>
    </>
  );
}

type DragHandlers = {
  start: (key: string, index: number) => void;
  move: (translationY: number) => void;
  end: (canceled: boolean) => void;
  /**
   * Hands the list a mounted row's offset, so a drag can move the row aside
   * without re-rendering it. Sets the offset for the row's index right away;
   * returns the call that lets it go.
   */
  trackOffset: (index: number, offset: SharedValue<number>) => () => void;
};

type RowProps = {
  entry: QueueEntry;
  index: number;
  track: QueueTrack | undefined;
  /** The row being dragged leaves a gap; its lifted copy follows the finger. */
  lifted: boolean;
  drag: DragHandlers;
  translation: SharedValue<number>;
  count: number;
};

function UpNextRow({ entry, index, track, lifted, drag, translation, count }: RowProps) {
  const secondary = useThemeColor("secondary");
  const offset = useSharedValue(0);
  const { start, move, end, trackOffset } = drag;
  // A layout effect, so a new order and the offsets reset for it land together.
  useLayoutEffect(() => trackOffset(index, offset), [trackOffset, index, offset]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  const key = entry.key;
  const pan = usePanGesture(
    useMemo(
      () => ({
        minDistance: 0,
        onActivate: () => {
          "worklet";
          translation.set(0);
          scheduleOnRN(start, key, index);
        },
        onUpdate: (event: { translationY: number }) => {
          "worklet";
          translation.set(event.translationY);
          scheduleOnRN(move, event.translationY);
        },
        onDeactivate: (event: { canceled: boolean }) => {
          "worklet";
          scheduleOnRN(end, event.canceled);
        },
      }),
      [start, move, end, key, index, translation],
    ),
  );

  const title = track?.title ?? "Song";
  return (
    <Animated.View style={[{ height: ROW, opacity: lifted ? 0 : 1 }, style]}>
      <View className="flex-1 flex-row items-center">
        <Press
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${track?.artist ?? ""}`}
          accessibilityHint="Plays this song now"
          accessibilityActions={[
            { name: "remove", label: "Remove from Up Next" },
            ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
            ...(index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
          ]}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === "remove") removeQueueEntry(key);
            if (action === "moveUp")
              void moveQueueEntry(upNextMove(queueState.get(), key, index - 1));
            if (action === "moveDown")
              void moveQueueEntry(upNextMove(queueState.get(), key, index + 1));
          }}
          onPress={() => playQueueEntry(key)}
          depth={0.015}
          className="flex-1 flex-row items-center self-stretch"
          style={{ gap: CELL * 1.5 }}
        >
          <RowText track={track} />
        </Press>
        <Press
          accessibilityRole="button"
          accessibilityLabel={`Remove ${title} from Up Next`}
          onPress={() => removeQueueEntry(key)}
          haptic="selection"
          depth={0.1}
          className="items-center justify-center"
          style={{ width: CELL * 6, height: CELL * 6 }}
        >
          <IconX size={20} color={secondary} strokeWidth={1.5} />
        </Press>
        <GestureDetector gesture={pan}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="items-center justify-center"
            style={{ width: CELL * 6, height: CELL * 6 }}
          >
            <IconMenu2 size={20} color={secondary} strokeWidth={1.5} />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

/** How many rows' places the row at [index] stands aside for a drag over the list. */
const shiftAt = (index: number, target: { from: number; to: number } | null): number =>
  target === null ? 0 : reorderShift({ index, from: target.from, to: target.to });

/** The row being dragged, or dropped and settling into its slot. */
type Drag = {
  readonly key: string;
  readonly from: number;
};

/**
 * Up Next: tap a row to play it, X to remove it, and drag its handle to move
 * it. Near the list's top or bottom edge a drag scrolls the list.
 *
 * While a row is dragged, the others step aside on the UI thread (no React
 * render per drop target). On drop the lifted copy settles into its slot,
 * then the new order lands in one render with the offsets reset, and stays
 * shown (`withPendingMoves`) until the queue has it.
 */
export function UpNextList({ bottomInset }: { bottomInset: number }) {
  useRenderCount("UpNextList");
  usePerfVisible("queue");
  const queue = useQueue();
  const [pending, setPending] = useState<readonly PendingMove[]>([]);
  const shown = useMemo(() => withPendingMoves(queue, pending), [queue, pending]);
  const entries = useMemo(() => upNext(shown), [shown]);
  const tracks = useQueueTracks(queue.entries);
  const playingKey = currentEntry(queue)?.key ?? null;

  const listRef = useRef<LegendListRef>(null);
  const scrollY = useRef(0);
  const height = useSharedValue(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The live drag, for the gesture callbacks and the auto-scroll loop.
  const live = useRef<{
    key: string;
    from: number;
    startScroll: number;
    translation: number;
    to: number;
  } | null>(null);
  // Where the rows stand aside for: the live drag's target, or the drop while it settles.
  const shifted = useRef<{ from: number; to: number } | null>(null);
  // Mounted rows' offsets, with the index and shift each was last given.
  const rows = useRef(new Map<SharedValue<number>, { index: number; shift: number }>());
  // Lands a drop that is settling; null when none is.
  const settling = useRef<(() => void) | null>(null);
  // True from a drop landing until the list has rendered its new order.
  const landing = useRef(false);
  // A drag that started while a drop was landing: it starts once the new order is rendered.
  const deferredStart = useRef<string | null>(null);
  // The order on screen, for turning a drop index into a move.
  const shownNow = useRef(shown);
  useLayoutEffect(() => {
    shownNow.current = shown;
  }, [shown]);
  const autoscroll = useRef<{ speed: number; frame: number | null; last: number }>({
    speed: 0,
    frame: null,
    last: 0,
  });
  const translation = useSharedValue(0);
  const liftedTop = useSharedValue(0);

  /** Moves every mounted row whose shift changed: gliding during a drag, at once otherwise. */
  const applyShifts = useCallback((animate: boolean) => {
    for (const [offset, row] of rows.current) {
      const shift = shiftAt(row.index, shifted.current);
      if (shift === row.shift) continue;
      row.shift = shift;
      offset.set(
        animate ? withTiming(shift * ROW, { duration: 160, easing: EASE_OUT }) : shift * ROW,
      );
    }
  }, []);

  const trackOffset = useCallback((index: number, offset: SharedValue<number>) => {
    const shift = shiftAt(index, shifted.current);
    offset.set(shift * ROW);
    const tracked = rows.current;
    tracked.set(offset, { index, shift });
    return () => {
      tracked.delete(offset);
    };
  }, []);

  const begin = useCallback(
    (key: string, index: number) => {
      live.current = { key, from: index, startScroll: scrollY.current, translation: 0, to: index };
      shifted.current = { from: index, to: index };
      liftedTop.set(index * ROW - scrollY.current);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDrag({ key, from: index });
    },
    [liftedTop],
  );

  // After the render a drop landed in: any row that kept its index lets go of
  // its shift too, and a drag that began meanwhile starts from its new index.
  useLayoutEffect(() => {
    if (!landing.current) return;
    landing.current = false;
    applyShifts(false);
    const key = deferredStart.current;
    deferredStart.current = null;
    if (key === null) return;
    const index = entries.findIndex((entry) => entry.key === key);
    if (index >= 0) begin(key, index);
  });

  const retarget = useCallback(() => {
    const current = live.current;
    if (current === null) return;
    const to = reorderTarget({
      from: current.from,
      distance: current.translation + (scrollY.current - current.startScroll),
      rowHeight: ROW,
      count: entries.length,
    });
    if (to === current.to) return;
    current.to = to;
    shifted.current = { from: current.from, to };
    void Haptics.selectionAsync();
    applyShifts(true);
  }, [entries.length, applyShifts]);

  const stopAutoscroll = useCallback(() => {
    const state = autoscroll.current;
    state.speed = 0;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
  }, []);

  const tick = useCallback(
    function step(time: number) {
      const state = autoscroll.current;
      if (state.speed === 0 || live.current === null) {
        state.frame = null;
        return;
      }
      const seconds = state.last === 0 ? 0 : (time - state.last) / 1000;
      state.last = time;
      const max = Math.max(0, entries.length * ROW + bottomInset - height.get());
      const next = Math.min(max, Math.max(0, scrollY.current + state.speed * seconds));
      if (next !== scrollY.current) {
        scrollY.current = next;
        void listRef.current?.scrollToOffset({ offset: next, animated: false });
        retarget();
      }
      state.frame = requestAnimationFrame(step);
    },
    [entries.length, bottomInset, retarget, height],
  );

  const start = useCallback(
    (key: string, index: number) => {
      // A drop still settling lands now. Until its new order is rendered
      // [index] is stale, so the drag starts once it is.
      settling.current?.();
      if (landing.current) {
        deferredStart.current = key;
        return;
      }
      begin(key, index);
    },
    [begin],
  );

  const move = useCallback(
    (dy: number) => {
      const current = live.current;
      if (current === null) return;
      current.translation = dy;
      retarget();
      // Scroll when the lifted row nears the list's top or bottom edge.
      const top = current.from * ROW - current.startScroll + dy;
      const bottomGap = height.get() - (top + ROW);
      const speed =
        top < AUTOSCROLL_EDGE
          ? -AUTOSCROLL_SPEED * Math.min(1, (AUTOSCROLL_EDGE - top) / AUTOSCROLL_EDGE)
          : bottomGap < AUTOSCROLL_EDGE
            ? AUTOSCROLL_SPEED * Math.min(1, (AUTOSCROLL_EDGE - bottomGap) / AUTOSCROLL_EDGE)
            : 0;
      const state = autoscroll.current;
      state.speed = speed;
      if (speed !== 0 && state.frame === null) {
        state.last = 0;
        state.frame = requestAnimationFrame(tick);
      }
    },
    [retarget, tick, height],
  );

  const end = useCallback(
    (canceled: boolean) => {
      stopAutoscroll();
      // Let go before a deferred drag could start: it never does.
      deferredStart.current = null;
      const current = live.current;
      live.current = null;
      if (current === null) return;
      const { key, from } = current;
      const to = canceled ? from : current.to;
      // Named by its neighbours, so a track change before the queue takes it keeps the order.
      const moved: PendingMove = upNextMove(shownNow.current, key, to);
      if (to !== current.to) {
        shifted.current = { from, to };
        applyShifts(true);
      }
      // Once the lifted copy is in its slot: the copy goes, and the new order
      // lands with every row's offset reset for it, in one render.
      const land = (): void => {
        if (settling.current !== land) return;
        settling.current = null;
        shifted.current = null;
        landing.current = true;
        setDrag(null);
        if (to === from) return;
        setPending((list) => [...list, moved]);
        void moveQueueEntry(moved).finally(() =>
          setPending((list) => list.filter((pendingMove) => pendingMove !== moved)),
        );
      };
      settling.current = land;
      // The lifted copy settles into the gap it was dropped on.
      translation.set(
        withTiming(
          to * ROW - scrollY.current - (from * ROW - current.startScroll),
          { duration: 120, easing: EASE_OUT },
          () => {
            scheduleOnRN(land);
          },
        ),
      );
    },
    [stopAutoscroll, translation, applyShifts],
  );

  useEffect(() => stopAutoscroll, [stopAutoscroll]);

  const handlers = useMemo<DragHandlers>(
    () => ({ start, move, end, trackOffset }),
    [start, move, end, trackOffset],
  );

  const liftedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: Math.min(
          Math.max(0, height.get() - ROW),
          Math.max(0, liftedTop.get() + translation.get()),
        ),
      },
    ],
  }));

  const renderItem = useCallback(
    ({ item, index }: { item: QueueEntry; index: number }) => (
      <UpNextRow
        entry={item}
        index={index}
        track={tracks.get(item.trackId)}
        lifted={drag?.key === item.key}
        drag={handlers}
        translation={translation}
        count={entries.length}
      />
    ),
    [tracks, drag, handlers, translation, entries.length],
  );
  // Legend List re-renders a row only when its item or extraData changes, and a
  // queue picked back up after JS restarted learns its tracks after the first render.
  const rowState = useMemo(() => ({ tracks, drag }), [tracks, drag]);

  if (entries.length === 0) {
    return (
      <View className="flex-1" style={{ paddingTop: CELL * 2 }}>
        <Text className="font-sans text-subheadline text-secondary">
          {playingKey === null ? "Nothing is playing." : "Nothing up next."}
        </Text>
      </View>
    );
  }

  const liftedTrack = drag === null ? undefined : tracks.get(entries[drag.from]?.trackId ?? "");

  return (
    <View
      className="flex-1 overflow-hidden"
      onLayout={(event) => {
        height.set(event.nativeEvent.layout.height);
      }}
    >
      <LegendList
        ref={listRef}
        className="flex-1"
        data={entries}
        keyExtractor={(entry) => entry.key}
        renderItem={renderItem}
        extraData={rowState}
        estimatedItemSize={ROW}
        alwaysRender={drag === null ? undefined : { keys: [drag.key] }}
        scrollEnabled={drag === null}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: bottomInset }}
      />
      {drag !== null && (
        <Animated.View
          pointerEvents="none"
          className="absolute left-0 right-0 top-0 flex-row items-center bg-surface"
          style={[{ height: ROW, gap: CELL * 1.5 }, liftedStyle]}
        >
          <RowText track={liftedTrack} />
          <View style={{ width: CELL * 12 }} />
        </Animated.View>
      )}
    </View>
  );
}
