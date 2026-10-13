import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import {
  IconArrowsShuffle,
  IconMenu2,
  IconRepeat,
  IconRepeatOnce,
  IconX,
} from "@tabler/icons-react-native";
import {
  currentEntry,
  reorderShift,
  counted,
  reorderTarget,
  upNext,
  type QueueEntry,
  type RepeatMode,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
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
import {
  cycleRepeat,
  moveQueueEntry,
  playQueueEntry,
  removeQueueEntry,
  toggleShuffle,
} from "@/playback/actions";
import { useQueue } from "@/playback/hooks";
import type { PlaybackState } from "@/playback/Player";
import type { QueueTrack } from "@/playback/queueTracks";
import { useThemeColor } from "@/theme/useThemeColor";

import { useQueueTracks } from "./hooks";
import { TrackHeader } from "./TrackHeader";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const ROW = grid.row;
const THUMB = CELL * 5;
const EASE_OUT = Easing.out(Easing.exp);

/** Distance from the list's top or bottom edge where a dragged row starts scrolling it, in dp. */
const AUTOSCROLL_EDGE = ROW;
/** Auto-scroll speed at the very edge, in dp per second. */
const AUTOSCROLL_SPEED = ROW * 12;

const thumbUri = (song: QueueTrack | undefined): string | undefined =>
  song?.thumbPath == null ? undefined : `file://${song.thumbPath}`;

type ToggleProps = {
  icon: ComponentType<IconProps>;
  label: string;
  on: boolean;
  onPress: () => void;
};

/** A labelled toggle: teal while it's on, graphite while it's off. */
function Toggle({ icon: Icon, label, on, onPress }: ToggleProps) {
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const color = on ? accent : secondary;
  return (
    <Press
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={onPress}
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
 * toggles, then the Up Next heading. Sits in the sheet's drag-to-dismiss area.
 */
export function QueueHeader({ item }: { item: NonNullable<PlaybackState["item"]> }) {
  const queue = useQueue();
  const count = queue.entries.length - queue.index - 1;
  return (
    <View>
      <TrackHeader item={item} />
      <Hairline />
      <View className="flex-row" style={{ gap: CELL }}>
        <Toggle
          icon={IconArrowsShuffle}
          label="Shuffle"
          on={queue.shuffle}
          onPress={toggleShuffle}
        />
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
  song: QueueTrack | undefined;
};

/** Thumbnail, title and artist: the part of an Up Next row that a drag lifts. */
function RowText({ song }: RowContentProps) {
  return (
    <>
      <Artwork uri={thumbUri(song)} size={THUMB} />
      <View className="flex-1">
        <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
          {song?.title ?? " "}
        </Text>
        <Text numberOfLines={1} className="font-sans text-body text-secondary">
          {song?.artist ?? " "}
        </Text>
      </View>
    </>
  );
}

type DragHandlers = {
  start: (key: string, index: number) => void;
  move: (translationY: number) => void;
  end: (canceled: boolean) => void;
};

type RowProps = {
  entry: QueueEntry;
  index: number;
  song: QueueTrack | undefined;
  /** Rows to step aside while another row is dragged over this one: -1, 0 or 1. */
  shift: number;
  /** Shifts animate while a drag is going on and snap once the new order lands. */
  animateShift: boolean;
  /** The row being dragged leaves a gap; its lifted copy follows the finger. */
  lifted: boolean;
  drag: DragHandlers;
  translation: SharedValue<number>;
  count: number;
};

function UpNextRow({
  entry,
  index,
  song,
  shift,
  animateShift,
  lifted,
  drag,
  translation,
  count,
}: RowProps) {
  const secondary = useThemeColor("secondary");
  const offset = useSharedValue(shift * ROW);

  useEffect(() => {
    offset.set(
      animateShift ? withTiming(shift * ROW, { duration: 160, easing: EASE_OUT }) : shift * ROW,
    );
  }, [shift, animateShift, offset]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  const { start, move, end } = drag;
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

  const title = song?.title ?? "Song";
  return (
    <Animated.View style={[{ height: ROW, opacity: lifted ? 0 : 1 }, style]}>
      <View className="flex-1 flex-row items-center">
        <Press
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${song?.artist ?? ""}`}
          accessibilityHint="Plays this song now"
          accessibilityActions={[
            { name: "remove", label: "Remove from Up Next" },
            ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
            ...(index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
          ]}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === "remove") removeQueueEntry(key);
            if (action === "moveUp") moveQueueEntry(key, index - 1);
            if (action === "moveDown") moveQueueEntry(key, index + 1);
          }}
          onPress={() => playQueueEntry(key)}
          depth={0.015}
          className="flex-1 flex-row items-center self-stretch"
          style={{ gap: CELL * 1.5 }}
        >
          <RowText song={song} />
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

/** A drag in progress, or one dropped and waiting for the queue to take the new order. */
type Drag = {
  readonly key: string;
  readonly from: number;
  readonly to: number;
  /** Set on drop: the Up Next list the drop was made against. */
  readonly droppedOn: readonly QueueEntry[] | null;
};

/**
 * Up Next: tap a row to play it, X to remove it, and drag its handle to move
 * it. Near the list's top or bottom edge a drag scrolls the list.
 */
export function UpNextList({ bottomInset }: { bottomInset: number }) {
  const queue = useQueue();
  const entries = useMemo(() => upNext(queue), [queue]);
  const songs = useQueueTracks(queue.entries);
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
  const autoscroll = useRef<{ speed: number; frame: number | null; last: number }>({
    speed: 0,
    frame: null,
    last: 0,
  });
  const translation = useSharedValue(0);
  const liftedTop = useSharedValue(0);

  // A drop is over once the queue has the new order (or after a second, if it never comes).
  const active =
    drag !== null && (drag.droppedOn === null || drag.droppedOn === entries) ? drag : null;
  useEffect(() => {
    if (drag?.droppedOn == null) return undefined;
    const timer = setTimeout(() => setDrag(null), 1000);
    return () => clearTimeout(timer);
  }, [drag]);

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
    void Haptics.selectionAsync();
    setDrag((previous) => (previous === null ? previous : { ...previous, to }));
  }, [entries.length]);

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
      live.current = { key, from: index, startScroll: scrollY.current, translation: 0, to: index };
      liftedTop.set(index * ROW - scrollY.current);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDrag({ key, from: index, to: index, droppedOn: null });
    },
    [liftedTop],
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
      const current = live.current;
      live.current = null;
      if (current === null) return;
      const to = canceled ? current.from : current.to;
      // The lifted copy settles into the gap it was dropped on.
      translation.set(
        withTiming(to * ROW - scrollY.current - (current.from * ROW - current.startScroll), {
          duration: 120,
          easing: EASE_OUT,
        }),
      );
      if (to === current.from) {
        setDrag(null);
        return;
      }
      setDrag({ key: current.key, from: current.from, to, droppedOn: entries });
      moveQueueEntry(current.key, to);
    },
    [entries, stopAutoscroll, translation],
  );

  useEffect(() => stopAutoscroll, [stopAutoscroll]);

  const handlers = useMemo<DragHandlers>(() => ({ start, move, end }), [start, move, end]);

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
        song={songs.get(item.trackId)}
        shift={active === null ? 0 : reorderShift({ index, from: active.from, to: active.to })}
        animateShift={active !== null}
        lifted={active?.key === item.key}
        drag={handlers}
        translation={translation}
        count={entries.length}
      />
    ),
    [songs, active, handlers, translation, entries.length],
  );
  // Legend List re-renders a row only when its item or extraData changes, and a
  // queue picked back up after JS restarted learns its songs after the first render.
  const rowState = useMemo(() => ({ songs, active }), [songs, active]);

  if (entries.length === 0) {
    return (
      <View className="flex-1" style={{ paddingTop: CELL * 2 }}>
        <Text className="font-sans text-subheadline text-secondary">
          {playingKey === null ? "Nothing is playing." : "Nothing up next."}
        </Text>
      </View>
    );
  }

  const liftedSong = active === null ? undefined : songs.get(entries[active.from]?.trackId ?? "");

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
        alwaysRender={active === null ? undefined : { keys: [active.key] }}
        scrollEnabled={active === null}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: bottomInset }}
      />
      {active !== null && (
        <Animated.View
          pointerEvents="none"
          className="absolute left-0 right-0 top-0 flex-row items-center bg-surface"
          style={[{ height: ROW, gap: CELL * 1.5 }, liftedStyle]}
        >
          <RowText song={liftedSong} />
          <View style={{ width: CELL * 12 }} />
        </Animated.View>
      )}
    </View>
  );
}
