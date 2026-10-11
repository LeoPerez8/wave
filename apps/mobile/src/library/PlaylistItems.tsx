import { IconGripVertical, IconTrash } from "@tabler/icons-react-native";
import { moveItem, reorderTarget, resolveRemoveSwipe } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  measure,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useScrollOffset,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openTrackActions } from "@/playback/TrackActionsSheet";
import { useThemeColor } from "@/theme/useThemeColor";

import { useFavoriteIds } from "./favorites";
import type { PlaylistDetail, PlaylistItemRow } from "./LibraryStore";
import { movePlaylistItem, removePlaylistItem } from "./playlists";
import { toTrackSummary } from "./TrackList";

const ROW = grid.row;
/** How close to the top or bottom of the list a dragged row starts scrolling it. */
const SCROLL_ZONE = ROW;
/** Fastest auto-scroll, in dp per frame, with the finger at the very edge. */
const SCROLL_STEP = CELL;
const DRAG_SLOP = 12;
const SHIFT_MS = 120;

/** What every row shares while one of them is dragged. */
interface DragState {
  /** The dragged row's index, or -1. */
  readonly active: SharedValue<number>;
  /** Where it would land if dropped now. */
  readonly hover: SharedValue<number>;
  /** How far it has moved, scrolling included. */
  readonly dragY: SharedValue<number>;
  /** The finger's travel since the drag began, scrolling not included. */
  readonly translation: SharedValue<number>;
  readonly fingerY: SharedValue<number>;
  readonly startScroll: SharedValue<number>;
  readonly scroll: SharedValue<number>;
}

type RowProps = {
  item: PlaylistItemRow;
  index: number;
  count: number;
  drag: DragState;
  playing: boolean;
  favorite: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onDragBegin: (index: number) => void;
  onDragMove: (offsetY: number) => void;
  onDrop: (canceled: boolean) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (item: PlaylistItemRow) => void;
};

/**
 * A playlist song: a track row that swipes left to remove, with a grip on the
 * right to drag it elsewhere. Screen readers get Move up / Move down / Remove.
 */
function PlaylistItem({
  item,
  index,
  count,
  drag,
  playing,
  favorite,
  onPress,
  onLongPress,
  onDragBegin,
  onDragMove,
  onDrop,
  onMove,
  onRemove,
}: RowProps) {
  const fill = useThemeColor("fill");
  const secondary = useThemeColor("secondary");
  const reduceMotion = useReducedMotion();
  const { active, hover, dragY, translation, fingerY, startScroll, scroll } = drag;

  // Other rows make way for the dragged one.
  const shift = useSharedValue(0);
  useAnimatedReaction(
    () => {
      const from = active.get();
      const to = hover.get();
      if (from === -1 || from === index) return 0;
      if (index > from && index <= to) return -ROW;
      if (index < from && index >= to) return ROW;
      return 0;
    },
    (next, previous) => {
      if (next === previous) return;
      // A drop lands at once: the list re-renders in the new order underneath.
      shift.set(
        active.get() === -1 || reduceMotion ? next : withTiming(next, { duration: SHIFT_MS }),
      );
    },
    [index, reduceMotion],
  );

  const offsetX = useSharedValue(0);
  const width = useSharedValue(1);
  const widthRef = useRef(1);

  const rowStyle = useAnimatedStyle(() => {
    const dragged = active.get() === index;
    return {
      zIndex: dragged ? 1 : 0,
      backgroundColor: dragged ? fill : "transparent",
      transform: [{ translateY: dragged ? dragY.get() : shift.get() }],
    };
  });
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.get() }],
  }));
  const revealStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, -offsetX.get() / (width.get() / 3)),
  }));

  const finishSwipe = (translationX: number, velocityX: number, canceled: boolean) => {
    const remove =
      !canceled && resolveRemoveSwipe({ translationX, velocityX, width: widthRef.current });
    if (!remove) {
      offsetX.set(withSpring(0, { damping: 20, stiffness: 240 }));
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (reduceMotion) {
      onRemove(item);
      return;
    }
    offsetX.set(
      withTiming(-widthRef.current, { duration: 160 }, (finished) => {
        if (finished) scheduleOnRN(onRemove, item);
      }),
    );
  };

  const swipe = usePanGesture({
    // Leftwards only; a vertical move belongs to the list.
    activeOffsetX: -DRAG_SLOP,
    failOffsetY: [-DRAG_SLOP, DRAG_SLOP],
    onUpdate: (event) => {
      "worklet";
      offsetX.set(Math.min(0, event.translationX));
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(finishSwipe, event.translationX, event.velocityX, event.canceled);
    },
  });

  const grip = usePanGesture({
    minDistance: 0,
    onActivate: (event) => {
      "worklet";
      startScroll.set(scroll.get());
      translation.set(0);
      dragY.set(0);
      fingerY.set(event.absoluteY);
      hover.set(index);
      active.set(index);
      scheduleOnRN(onDragBegin, index);
    },
    onUpdate: (event) => {
      "worklet";
      translation.set(event.translationY);
      fingerY.set(event.absoluteY);
      dragY.set(event.translationY + scroll.get() - startScroll.get());
      scheduleOnRN(onDragMove, dragY.get());
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(onDrop, event.canceled);
    },
  });

  return (
    <Animated.View
      style={rowStyle}
      onLayout={(event) => {
        const measured = Math.max(1, event.nativeEvent.layout.width);
        widthRef.current = measured;
        width.set(measured);
      }}
    >
      <Animated.View
        pointerEvents="none"
        className="absolute bottom-0 right-0 top-0 flex-row items-center bg-fill"
        style={[{ gap: CELL, paddingHorizontal: CELL * 2 }, revealStyle]}
      >
        <IconTrash size={20} color={secondary} strokeWidth={1.5} />
        <Text className="font-sans text-body font-medium text-secondary">Remove</Text>
      </Animated.View>
      <Animated.View className="flex-row items-center bg-background" style={contentStyle}>
        <GestureDetector gesture={swipe}>
          <View className="flex-1">
            <TrackRow
              track={toTrackSummary(item)}
              state={playing ? "playing" : undefined}
              favorite={favorite}
              leading="artwork"
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityActions={[
                ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
                ...(index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
                { name: "remove", label: "Remove from playlist" },
              ]}
              onAccessibilityAction={(event) => {
                const action = event.nativeEvent.actionName;
                if (action === "moveUp") onMove(index, index - 1);
                else if (action === "moveDown") onMove(index, index + 1);
                else if (action === "remove") onRemove(item);
              }}
            />
          </View>
        </GestureDetector>
        <GestureDetector gesture={grip}>
          <View
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            className="items-end justify-center"
            // 48dp of target for a grip drawn in the 32dp state cell.
            style={{ width: grid.stateCell + CELL * 2, height: ROW, marginLeft: -CELL * 2 }}
          >
            <IconGripVertical size={20} color={secondary} strokeWidth={1.5} />
          </View>
        </GestureDetector>
      </Animated.View>
    </Animated.View>
  );
}

type Props = {
  detail: PlaylistDetail;
  /** The playlist's head (mosaic, title, Play / Shuffle). */
  header: ReactElement;
  /** Shown under the head when the playlist has no songs. */
  empty: ReactElement;
};

/**
 * A playlist's songs in order: tap plays the playlist from the song, the grip
 * drags it to a new place (scrolling the list near its edges), a left swipe
 * removes it, long-press opens its menu.
 */
export function PlaylistItems({ detail, header, empty }: Props) {
  const playlistId = detail.playlist.id;
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();

  // The owner's last edit, shown until the store's next read replaces `detail.items`.
  const [edit, setEdit] = useState<{
    readonly base: readonly PlaylistItemRow[];
    readonly order: readonly PlaylistItemRow[];
  } | null>(null);
  const order = edit !== null && edit.base === detail.items ? edit.order : detail.items;
  const setOrder = (next: (current: readonly PlaylistItemRow[]) => readonly PlaylistItemRow[]) =>
    setEdit((previous) => ({
      base: detail.items,
      order: next(
        previous !== null && previous.base === detail.items ? previous.order : detail.items,
      ),
    }));
  const orderRef = useRef(order);
  useLayoutEffect(() => {
    orderRef.current = order;
  });

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const drag: DragState = {
    active: useSharedValue(-1),
    hover: useSharedValue(-1),
    dragY: useSharedValue(0),
    translation: useSharedValue(0),
    fingerY: useSharedValue(0),
    startScroll: useSharedValue(0),
    scroll: useSharedValue(0),
  };
  useScrollOffset(scrollRef, drag.scroll);
  const contentHeight = useSharedValue(0);

  const from = useRef(-1);
  const target = useRef(-1);
  const resetAfterRender = useRef(false);

  const endDrag = () => {
    drag.active.set(-1);
    drag.hover.set(-1);
    drag.dragY.set(0);
  };

  // Rows drop into place in the same frame the new order renders.
  useLayoutEffect(() => {
    if (!resetAfterRender.current) return;
    resetAfterRender.current = false;
    endDrag();
  });

  const reorder = (fromIndex: number, toIndex: number): boolean => {
    const current = orderRef.current;
    const item = current[fromIndex];
    if (item === undefined || toIndex === fromIndex || toIndex < 0 || toIndex >= current.length)
      return false;
    setOrder(() => moveItem(current, fromIndex, toIndex));
    void movePlaylistItem(playlistId, item.itemId, toIndex);
    return true;
  };

  const onDragBegin = (index: number) => {
    from.current = index;
    target.current = index;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const onDragMove = (offsetY: number) => {
    if (from.current < 0) return;
    const next = reorderTarget({
      from: from.current,
      distance: offsetY,
      rowHeight: ROW,
      count: orderRef.current.length,
    });
    if (next === target.current) return;
    target.current = next;
    drag.hover.set(next);
    void Haptics.selectionAsync();
  };

  const onDrop = (canceled: boolean) => {
    const moved = !canceled && from.current >= 0 && reorder(from.current, target.current);
    from.current = -1;
    target.current = -1;
    if (moved) resetAfterRender.current = true;
    else endDrag();
  };

  const onRemove = (item: PlaylistItemRow) => {
    setOrder((current) => current.filter((row) => row.itemId !== item.itemId));
    void removePlaylistItem(playlistId, item.itemId);
  };

  // Near the top or bottom edge, a dragged row scrolls the list, faster the closer it gets.
  useFrameCallback(() => {
    if (drag.active.get() === -1) return;
    const box = measure(scrollRef);
    if (box === null) return;
    const y = drag.fingerY.get() - box.pageY;
    const bottomZone = box.height - bottomInset - SCROLL_ZONE;
    let step = 0;
    if (y < SCROLL_ZONE) step = -SCROLL_STEP * Math.min(1, (SCROLL_ZONE - y) / SCROLL_ZONE);
    else if (y > bottomZone) step = SCROLL_STEP * Math.min(1, (y - bottomZone) / SCROLL_ZONE);
    if (step === 0) return;
    const max = Math.max(0, contentHeight.get() - box.height);
    const next = Math.min(max, Math.max(0, drag.scroll.get() + step));
    if (next === drag.scroll.get()) return;
    scrollTo(scrollRef, 0, next, false);
    drag.scroll.set(next);
    drag.dragY.set(drag.translation.get() + next - drag.startScroll.get());
    scheduleOnRN(onDragMove, drag.dragY.get());
  });

  const context = { kind: "playlist", id: String(playlistId) } as const;

  return (
    <Animated.ScrollView
      ref={scrollRef}
      className="flex-1"
      onContentSizeChange={(_, height) => contentHeight.set(height)}
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
    >
      {header}
      {order.length === 0
        ? empty
        : order.map((item, index) => (
            <PlaylistItem
              key={item.itemId}
              item={item}
              index={index}
              count={order.length}
              drag={drag}
              playing={String(item.id) === currentId}
              favorite={favorites.has(item.id)}
              onPress={() => playSongs(order, index, context)}
              onLongPress={() => openTrackActions(item, { playlistId, itemId: item.itemId })}
              onDragBegin={onDragBegin}
              onDragMove={onDragMove}
              onDrop={onDrop}
              onMove={reorder}
              onRemove={onRemove}
            />
          ))}
    </Animated.ScrollView>
  );
}
