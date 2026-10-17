import { IconGripVertical, IconTrash } from "@tabler/icons-react-native";
import {
  moveItem,
  reorderTarget,
  resolveRemoveSwipe,
  rowWindow,
  windowRows,
  ytTrackId,
  type QueueContext,
  type RowView,
  type RowWindow,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Text,
  ToastAndroid,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
} from "react-native";
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
import { playPlaylist } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openTrackActions } from "@/playback/ActionsMenu";
import type { ActionItems, TrackItem } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection } from "@/selection/useListSelection";
import { useThemeColor } from "@/theme/useThemeColor";
import { YtSongRow } from "@/ytmusic/YtSongRow";
import { openYtSongActions } from "@/ytmusic/YtSongActions";

import {
  explainUnavailable,
  openUnavailableEntryActions,
  UnavailableSongRow,
} from "./UnavailableEntry";

import { useFavoriteIds } from "./favorites";
import type { PlaylistEntryRow } from "./LibraryStore";
import { movePlaylistItem, removePlaylistItems } from "./playlists";
import { toTrackSummary } from "./TrackList";
import { useListScrollable } from "@/motion/heldTouch";

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
  item: PlaylistEntryRow;
  index: number;
  count: number;
  drag: DragState;
  playing: boolean;
  favorite: boolean;
  /**
   * A Library song in a list with YT Music entries: it carries the downloaded
   * icon, as on integrated pages.
   */
  downloaded: boolean;
  /** Whether the list is in selection mode: no dragging or swiping then. */
  selecting: boolean;
  /** In selection mode, whether the row is checked; undefined otherwise. */
  checked: boolean | undefined;
  onPress: () => void;
  onLongPress: () => void;
  onDragBegin: (index: number) => void;
  onDragMove: (offsetY: number) => void;
  onDrop: (canceled: boolean) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (item: PlaylistEntryRow) => void;
};

/**
 * A playlist entry: a Library song's track row, a YT Music entry's stream
 * row with the YT Music song's menu, or an unavailable entry's dimmed row,
 * that swipes left to remove, with a grip on the right to drag it elsewhere.
 * Screen readers get Move up / Move down / Remove. While selecting, an
 * unavailable entry can't be checked.
 */
function PlaylistItem({
  item,
  index,
  count,
  drag,
  playing,
  favorite,
  downloaded,
  selecting,
  checked,
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
  // No swipe-to-remove while the long-pressed finger slides to choose in the menu.
  const swipeable = useListScrollable() && !selecting;
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
    enabled: swipeable,
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
    enabled: !selecting,
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

  const accessibilityActions = selecting
    ? []
    : [
        ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
        ...(index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
        { name: "remove", label: "Remove from playlist" },
      ];
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const action = event.nativeEvent.actionName;
    if (action === "moveUp") onMove(index, index - 1);
    else if (action === "moveDown") onMove(index, index + 1);
    else if (action === "remove") onRemove(item);
  };

  return (
    <Animated.View
      // Placed by index: only a window of rows is mounted (see `rowWindow`).
      style={[{ position: "absolute", top: index * ROW, left: 0, right: 0 }, rowStyle]}
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
            {item.source === "library" ? (
              <TrackRow
                track={toTrackSummary(item.track)}
                state={playing ? "playing" : undefined}
                favorite={favorite}
                leading="artwork"
                checked={checked}
                downloaded={downloaded}
                onPress={onPress}
                onLongPress={onLongPress}
                accessibilityActions={accessibilityActions}
                onAccessibilityAction={onAccessibilityAction}
              />
            ) : item.source === "stream" ? (
              <YtSongRow
                song={item.song}
                checked={checked}
                playing={playing}
                onPress={onPress}
                onLongPress={onLongPress}
                accessibilityActions={accessibilityActions}
                onAccessibilityAction={onAccessibilityAction}
              />
            ) : (
              <UnavailableSongRow
                song={item.song}
                checked={checked}
                onPress={onPress}
                onLongPress={onLongPress}
                accessibilityActions={accessibilityActions}
                onAccessibilityAction={onAccessibilityAction}
              />
            )}
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
            {/* Hidden, not removed, while selecting: the rows keep their width. */}
            {!selecting && <IconGripVertical size={20} color={secondary} strokeWidth={1.5} />}
          </View>
        </GestureDetector>
      </Animated.View>
    </Animated.View>
  );
}

type Props = {
  playlistId: number;
  /** In playlist order; undefined until they are read (only the header shows). */
  items: readonly PlaylistEntryRow[] | undefined;
  /** The playlist's head (mosaic, title, Play / Shuffle). */
  header: ReactElement;
  /** Shown under the head when the playlist has no songs. */
  empty: ReactElement;
};

const NO_ITEMS: readonly PlaylistEntryRow[] = [];

/** Each entry is its own selection item, so a song in the playlist twice is checked per copy. */
const entryKey = (item: PlaylistEntryRow): string => String(item.itemId);

/** The id the entry's song goes by in the queue, to show it playing; null for one that never plays. */
const queueId = (item: PlaylistEntryRow): string | null =>
  item.source === "library"
    ? String(item.track.id)
    : item.source === "stream"
      ? ytTrackId(item.song.videoId)
      : null;

/** Whether the entry can be checked: an unavailable entry has nothing the selection bar acts on. */
const checkable = (item: PlaylistEntryRow): boolean => item.source !== "unavailable";

/** While selecting, an unavailable entry's row does nothing. */
const INERT_ROW = { checked: undefined, onPress: () => undefined, onLongPress: () => undefined };

/**
 * Plays the playlist from [startIndex] (or from the top, or shuffled),
 * skipping its unavailable entries (Core's `playlistPlayback`): one tapped
 * says why it doesn't play, as does Play or Shuffle with nothing but
 * unavailable entries, and a YT Music entry tapped with YT Music off.
 */
export const playPlaylistEntries = (
  entries: readonly PlaylistEntryRow[],
  startIndex: number | undefined,
  context: QueueContext,
  options: { readonly shuffle?: boolean } = {},
): void => {
  const tapped = startIndex === undefined ? undefined : entries[startIndex];
  if (tapped?.source === "unavailable") {
    explainUnavailable(tapped.song);
    return;
  }
  void playPlaylist(entries, startIndex, context, options).then((notice) => {
    if (notice !== null) ToastAndroid.show(notice, ToastAndroid.LONG);
  });
};

/**
 * A playlist's songs in order, the Library's and YT Music's (streamed, with
 * the YT Music song's menu): tap plays the playlist from the song, the grip
 * drags it to a new place (scrolling the list near its edges), a left swipe
 * removes it, long-press opens its menu. The menu's Select starts selection
 * mode (check cells, taps toggle, no dragging or swiping), whose bar adds
 * Remove from Playlist, for Library and YT Music songs alike.
 */
export function PlaylistItems({ playlistId, items, header, empty }: Props) {
  const scrollable = useListScrollable();
  const read = items ?? NO_ITEMS;
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const placeOf = useCallback(
    (item: PlaylistEntryRow) => ({ playlistId, itemId: item.itemId }),
    [playlistId],
  );

  // The owner's last edit, shown until the store's next read replaces `items`.
  const [edit, setEdit] = useState<{
    readonly base: readonly PlaylistEntryRow[];
    readonly order: readonly PlaylistEntryRow[];
  } | null>(null);
  const order = edit !== null && edit.base === read ? edit.order : read;
  const setOrder = (next: (current: readonly PlaylistEntryRow[]) => readonly PlaylistEntryRow[]) =>
    setEdit((previous) => ({
      base: read,
      order: next(previous !== null && previous.base === read ? previous.order : read),
    }));
  // While YT Music entries are among them, the Library's songs carry the downloaded icon.
  const mixed = order.some((item) => item.source === "stream");
  const tracksOf = useCallback(
    (selected: readonly PlaylistEntryRow[]): ActionItems => ({
      kind: "track",
      items: selected.flatMap((item): TrackItem[] =>
        item.source === "library"
          ? [{ song: item.track, playlistItem: placeOf(item) }]
          : item.source === "stream"
            ? [{ ytSong: item.song, playlistItem: placeOf(item) }]
            : [],
      ),
    }),
    [placeOf],
  );
  const selectable = useMemo(() => order.filter(checkable), [order]);
  const listSelection = useListSelection({
    items: selectable,
    keyOf: entryKey,
    target: tracksOf,
  });
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

  // Only the rows around the screen are mounted, so a long playlist opens as
  // fast as a short one. Until laid out, the list is assumed to fill the
  // screen with no header above it: that mounts too many rows, never too few.
  const { height: screenHeight } = useWindowDimensions();
  const [viewport, setViewport] = useState(screenHeight);
  const [top, setTop] = useState(0);
  const count = order.length;
  const from = useRef(-1);
  // The window as of the last scroll that moved it, and the row being dragged then.
  const [shown, setShown] = useState<{
    readonly scroll: number;
    readonly rows: RowWindow;
    readonly keep: number;
  }>({ scroll: 0, rows: { start: 0, end: 0 }, keep: -1 });
  const viewAt = useCallback(
    (scroll: number): RowView => ({ scroll, viewport, top, rowHeight: ROW, count }),
    [viewport, top, count],
  );
  // Layout and length changes apply at once; scrolling moves the window in `follow`.
  const rows = rowWindow(viewAt(shown.scroll), shown.rows);
  const follow = useCallback(
    (scroll: number) =>
      setShown((previous) => {
        const current = rowWindow(viewAt(previous.scroll), previous.rows);
        const next = rowWindow(viewAt(scroll), current);
        return next === previous.rows ? previous : { scroll, rows: next, keep: from.current };
      }),
    [viewAt],
  );
  // Checked every row scrolled; the window moves only now and then.
  useAnimatedReaction(
    () => Math.round(drag.scroll.get() / ROW),
    (step, previous) => {
      if (previous !== null && step !== previous) scheduleOnRN(follow, drag.scroll.get());
    },
    [follow],
  );
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

  const onRemove = (item: PlaylistEntryRow) => {
    setOrder((current) => current.filter((row) => row.itemId !== item.itemId));
    void removePlaylistItems(playlistId, [item.itemId]);
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

  const renderRow = (index: number) => {
    const item = order[index];
    if (item === undefined) return null;
    const play = () => playPlaylistEntries(order, index, context);
    const row =
      item.source === "unavailable" && listSelection.selecting
        ? INERT_ROW
        : selectableRow(item, listSelection, play, (options) => {
            const menu = { ...options, playlistItem: placeOf(item) };
            if (item.source === "library") openTrackActions(item.track, menu);
            else if (item.source === "stream") openYtSongActions(item.song, menu);
            else openUnavailableEntryActions(item.song, placeOf(item));
          });
    return (
      <PlaylistItem
        key={item.itemId}
        item={item}
        index={index}
        count={order.length}
        drag={drag}
        playing={queueId(item) !== null && queueId(item) === currentId}
        favorite={item.source === "library" && favorites.has(item.track.id)}
        downloaded={mixed}
        selecting={listSelection.selecting}
        {...row}
        onDragBegin={onDragBegin}
        onDragMove={onDragMove}
        onDrop={onDrop}
        onMove={reorder}
        onRemove={onRemove}
      />
    );
  };

  return (
    <Animated.ScrollView
      scrollEnabled={scrollable}
      ref={scrollRef}
      className="flex-1"
      onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
      onContentSizeChange={(_, height) => contentHeight.set(height)}
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
    >
      <View onLayout={(event) => setTop(event.nativeEvent.layout.height)}>{header}</View>
      {items === undefined ? null : order.length === 0 ? (
        empty
      ) : (
        <View style={{ height: order.length * ROW }}>
          {/* The dragged row stays mounted however far auto-scroll takes the list. */}
          {windowRows(rows, shown.keep).map(renderRow)}
        </View>
      )}
    </Animated.ScrollView>
  );
}
