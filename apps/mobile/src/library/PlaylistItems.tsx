import { IconGripVertical, IconTrash } from "@tabler/icons-react-native";
import { moveItem, queueSongTrackId, resolveRemoveSwipe, type QueueContext } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Text, View, type AccessibilityActionEvent } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { playPlaylist } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openTrackActions, openUnsearchedActions } from "@/playback/ActionsMenu";
import type { ActionItems, TrackItem } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection } from "@/selection/useListSelection";
import { useThemeColor } from "@/theme/useThemeColor";
import { showToast } from "@/overlay/toast";
import { YtSongRow } from "@/ytmusic/YtSongRow";
import { openYtSongActions } from "@/ytmusic/YtSongActions";

import {
  explainUnavailable,
  openUnavailableEntryActions,
  UnavailableSongRow,
} from "./UnavailableEntry";

import { UnsearchedSongRow } from "./UnsearchedSongRow";

import { useFavoriteIds } from "./favorites";
import type { PlaylistEntryRow } from "./LibraryStore";
import { entryText, FIND_FIELD_HEIGHT, FindHead, useFindInList } from "./FindInPlaylist";
import {
  useDragCell,
  useListDrag,
  type DragHandlers,
  type DragState,
  type ListDrag,
} from "./listDrag";
import { movePlaylistItem, removePlaylistItems } from "./playlists";
import { toTrackSummary } from "./TrackList";
import { useListScrollable } from "@/motion/heldTouch";

const ROW = grid.row;
/** One column of rows, a row tall. */
const CELLS = { columns: 1, width: 0, height: ROW };
const DRAG_SLOP = 12;

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
  /** Whether the row can be dragged to a new place: not while Find in Playlist narrows the list. */
  reorderable: boolean;
  /** In selection mode, whether the row is checked; undefined otherwise. */
  checked: boolean | undefined;
  onPress: () => void;
  onLongPress: () => void;
  handlers: DragHandlers;
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
  reorderable,
  checked,
  onPress,
  onLongPress,
  handlers,
  onMove,
  onRemove,
}: RowProps) {
  const fill = useThemeColor("fill");
  const secondary = useThemeColor("secondary");
  const reduceMotion = useReducedMotion();
  // No swipe-to-remove while the long-pressed finger slides to choose in the menu.
  const swipeable = useListScrollable() && !selecting;
  const { style: rowStyle, grip } = useDragCell({
    drag,
    index,
    cells: CELLS,
    enabled: !selecting && reorderable,
    liftedColor: fill,
    handlers,
  });

  const offsetX = useSharedValue(0);
  const width = useSharedValue(1);
  const widthRef = useRef(1);

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

  const accessibilityActions = selecting
    ? []
    : [
        ...(reorderable && index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
        ...(reorderable && index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
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
            ) : item.source === "unsearched" ? (
              <UnsearchedSongRow
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
            {/* Hidden, not removed, while selecting or finding: the rows keep their width. */}
            {!selecting && reorderable && (
              <IconGripVertical size={20} color={secondary} strokeWidth={1.5} />
            )}
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
  item.source === "unavailable" ? null : queueSongTrackId(item);

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
    if (notice !== null) void showToast(notice);
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
  const mixed = order.some((item) => item.source === "stream" || item.source === "unsearched");
  const tracksOf = useCallback(
    (selected: readonly PlaylistEntryRow[]): ActionItems => ({
      kind: "track",
      items: selected.flatMap((item): TrackItem[] =>
        item.source === "library"
          ? [{ song: item.track, playlistItem: placeOf(item) }]
          : item.source === "stream"
            ? [{ ytSong: item.song, playlistItem: placeOf(item) }]
            : item.source === "unsearched"
              ? [{ unsearched: item.song, playlistItem: placeOf(item) }]
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
  // Find in Playlist: the list scrolls back to where it was once the query is cleared.
  const dragRef = useRef<ListDrag | null>(null);
  const find = useFindInList(
    order,
    entryText,
    () => dragRef.current?.drag.scroll.get() ?? 0,
    (y) => dragRef.current?.scrollRef.current?.scrollTo({ y, animated: false }),
  );
  // The rows shown: the whole playlist, or the songs the query finds, in playlist order.
  const { found, shown } = find;
  const orderRef = useRef(order);
  useLayoutEffect(() => {
    orderRef.current = order;
  });

  const reorder = (fromIndex: number, toIndex: number): boolean => {
    // A narrowed list has no places to move to.
    if (found !== null) return false;
    const current = orderRef.current;
    const item = current[fromIndex];
    if (item === undefined || toIndex === fromIndex || toIndex < 0 || toIndex >= current.length)
      return false;
    setOrder(() => moveItem(current, fromIndex, toIndex));
    void movePlaylistItem(playlistId, item.itemId, toIndex);
    return true;
  };
  const listDrag = useListDrag({ count: shown.length, cells: CELLS, bottomInset, move: reorder });
  const { scrollRef } = listDrag;
  useLayoutEffect(() => {
    dragRef.current = listDrag;
  });

  const onRemove = (item: PlaylistEntryRow) => {
    setOrder((current) => current.filter((row) => row.itemId !== item.itemId));
    void removePlaylistItems(playlistId, [item.itemId]);
  };

  const context = { kind: "playlist", id: String(playlistId) } as const;

  const renderRow = (index: number) => {
    const item = shown[index];
    if (item === undefined) return null;
    // A found song plays the whole playlist from its own place in it.
    const play = () => playPlaylistEntries(order, find.placeOf(index), context);
    const row =
      item.source === "unavailable" && listSelection.selecting
        ? INERT_ROW
        : selectableRow(item, listSelection, play, (options) => {
            const menu = { ...options, playlistItem: placeOf(item) };
            if (item.source === "library") openTrackActions(item.track, menu);
            else if (item.source === "stream") openYtSongActions(item.song, menu);
            else if (item.source === "unsearched") openUnsearchedActions(item.song, menu);
            else openUnavailableEntryActions(item.song, placeOf(item));
          });
    return (
      <PlaylistItem
        key={item.itemId}
        item={item}
        index={index}
        count={shown.length}
        drag={listDrag.drag}
        playing={queueId(item) !== null && queueId(item) === currentId}
        favorite={item.source === "library" && favorites.has(item.track.id)}
        downloaded={mixed}
        selecting={listSelection.selecting}
        reorderable={found === null}
        {...row}
        handlers={listDrag}
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
      onLayout={listDrag.onLayout}
      onContentSizeChange={listDrag.onContentSizeChange}
      // Find in Playlist waits above the head until the list is pulled down.
      contentOffset={{ x: 0, y: FIND_FIELD_HEIGHT }}
      contentContainerStyle={{
        paddingHorizontal: grid.margin,
        paddingBottom: bottomInset,
        minHeight: find.minHeight,
      }}
    >
      <View onLayout={listDrag.onHeaderLayout}>
        <FindHead find={find} header={header} />
      </View>
      {items !== undefined && found === null && order.length === 0 && empty}
      {items !== undefined && shown.length > 0 && (
        <View style={{ height: shown.length * ROW }}>
          {/* The dragged row stays mounted however far auto-scroll takes the list. */}
          {listDrag.indices.map(renderRow)}
        </View>
      )}
    </Animated.ScrollView>
  );
}
