import { PlaylistRecommendations } from "./PlaylistRecommendations";
import { IconGripVertical } from "@tabler/icons-react-native";
import type { LegendListRef } from "@legendapp/list/react-native";
import { moveItem, type PlaylistPlace, type QueueContext, type RowMenuAction } from "@wave/core";
import {
  cloneElement,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { View, type AccessibilityActionInfo } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedReaction, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { usePositions } from "@/lib/usePositions";
import { CELL, grid } from "@/catalog/grid";
import { ROW, useDraggedRow, useRowDrag, type DragRows } from "@/catalog/rowDrag";
import { useChromeInset } from "@/chrome/chrome";
import { useListScrollable } from "@/motion/heldTouch";
import { playPlaylist } from "@/playback/actions";
import { openTrackActions, openUnsearchedActions, type MenuOptions } from "@/playback/ActionsMenu";
import type { ActionItems, TrackItem } from "@/playback/actionTargets";
import { runTrackSwipe } from "@/playback/rowSwipe";
import { useListSelection } from "@/selection/useListSelection";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { SongList, type SongListSelection } from "@/songs/SongList";
import { librarySongEntry, type SongListEntry } from "@/songs/songListSources";
import type { SongRowActions } from "@/songs/SongRow";
import { useThemeColor } from "@/theme/useThemeColor";
import { showToast } from "@/overlay/toast";
import { openYtSongActions, runYtSongSwipe } from "@/ytmusic/YtSongActions";

import { explainUnavailable, openUnavailableEntryActions } from "./UnavailableEntry";
import type { PlaylistEntryRow } from "./LibraryStore";
import { entryText, FindFrame, FindHead, useFindInLegendList } from "./FindInPlaylist";
import { movePlaylistItem, removePlaylistItems } from "./playlists";

/** What the list holds besides the entries: the empty note, then the recommendations. */
type Slot = { readonly kind: "empty" } | { readonly kind: "recommendations" };
type Item = PlaylistEntryRow | Slot;

const EMPTY: Slot = { kind: "empty" };
const RECOMMENDATIONS: Slot = { kind: "recommendations" };

const entryOf = (item: Item): PlaylistEntryRow | null => ("kind" in item ? null : item);

/** Each entry is its own row and selection item, so a song in the playlist twice is checked per copy. */
const entryKey = (item: PlaylistEntryRow): string => String(item.itemId);
const itemKey = (item: Item): string => ("kind" in item ? item.kind : entryKey(item));
const slotType = (item: Item): string => ("kind" in item ? item.kind : "entry");
/** The empty note and the recommendations size themselves. */
const slotSize = (): undefined => undefined;

/** Whether the entry can be checked: an unavailable entry has nothing the selection bar acts on. */
const checkable = (item: PlaylistEntryRow): boolean => item.source !== "unavailable";

/**
 * A playlist entry's row: a Library song as the Library shows it, a YT Music
 * entry streamed with the YT Music song's menu, an unsearched entry as any
 * song (it plays, searched as it's about to), an unavailable one dimmed. Its
 * menu and swipes remove it from this playlist.
 */
const playlistEntry = (item: PlaylistEntryRow): SongListEntry => {
  switch (item.source) {
    case "library": {
      const entry = librarySongEntry(item.track);
      return { ...entry, facts: { ...entry.facts, inPlaylist: true } };
    }
    case "stream":
      return { source: { kind: "ytMusic", song: item.song }, facts: { inPlaylist: true } };
    case "unsearched":
      return {
        source: { kind: "unsearched", song: item.song },
        facts: {
          streamed: true,
          unsearched: true,
          artistNames: item.song.artists,
          inPlaylist: true,
        },
      };
    case "unavailable":
      return { source: { kind: "unavailable", song: item.song } };
  }
};

const NO_MOVES: readonly AccessibilityActionInfo[] = [];
const MOVE_UP = { name: "moveUp", label: "Move up" } as const;
const MOVE_DOWN = { name: "moveDown", label: "Move down" } as const;

/** The grip, 48dp of target drawn in the 32dp state cell. */
function Grip({ shown, color }: { shown: boolean; color: string }) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      className="items-end justify-center"
      style={{ width: grid.stateCell + CELL * 2, height: ROW, marginLeft: -CELL * 2 }}
    >
      {/* Hidden, not removed, while selecting or finding: the rows keep their width. */}
      {shown && <IconGripVertical size={20} color={color} strokeWidth={1.5} />}
    </View>
  );
}

/**
 * An entry's row with its grip on the right, dragged by it on the UI thread
 * (`useRowDrag`): it steps aside as another passes, and leaves a gap while
 * its lifted copy follows the finger. Memoized: it renders again only when
 * its row, its place or the drag's state for it changes.
 */
const DraggableEntry = memo(function DraggableEntry({
  row,
  rowKey,
  index,
  drag,
  lifted,
  grip,
}: {
  row: ReactElement<SongRowActions>;
  rowKey: string;
  index: number;
  drag: DragRows;
  lifted: boolean;
  /** The grip shows and drags: not while selecting or finding. */
  grip: boolean;
}) {
  const secondary = useThemeColor("secondary");
  const { pan, style } = useDraggedRow(drag, rowKey, index, grip);
  const accessory = useMemo(
    () => (
      <GestureDetector gesture={pan}>
        <Grip shown={grip} color={secondary} />
      </GestureDetector>
    ),
    [pan, grip, secondary],
  );
  return (
    <Animated.View style={[{ height: ROW, opacity: lifted ? 0 : 1 }, style]}>
      {cloneElement(row, { accessory })}
    </Animated.View>
  );
});

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
 * the YT Music song's menu), on the song list: tap plays the playlist from
 * the song, the grip drags it to a new place (scrolling the list near its
 * edges, saved on release), a swipe runs an entry of its menu as every song
 * row's does (left removes it from the playlist at once, right adds it to
 * the queue), long-press opens its menu. The menu's Select starts selection
 * mode (check cells, taps toggle, no dragging or swiping), whose bar adds
 * Remove from Playlist, for Library and YT Music songs alike. Screen readers
 * get Move up / Move down and the swipes' actions. While selecting, an
 * unavailable entry can't be checked and does nothing.
 */
export function PlaylistItems({ playlistId, items, header, empty }: Props) {
  const scrollable = useListScrollable();
  const read = items ?? NO_ITEMS;
  const bottomInset = useChromeInset();
  const fill = useThemeColor("fill");
  const secondary = useThemeColor("secondary");
  const placeOf = useCallback(
    (item: PlaylistEntryRow): PlaylistPlace => ({ playlistId, itemId: item.itemId }),
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
  const list = useRef<LegendListRef>(null);
  const find = useFindInLegendList(list, order, entryText, true);
  // The rows shown: the whole playlist, or the songs the query finds, in playlist order.
  const { found, shown } = find;
  const reorderable = found === null;
  const selecting = listSelection.selecting;
  const orderRef = useRef(order);
  useLayoutEffect(() => {
    orderRef.current = order;
  });
  const places = usePositions(order);

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

  // The rows start under the head (the Find field and the playlist's head).
  const [lead, setLead] = useState(0);
  const keys = useMemo(() => shown.map(entryKey), [shown]);
  const { drag, rowDrag, liftedStyle, height, scroll, scrollRef } = useRowDrag({
    keys,
    bottomInset,
    lead,
    scrollFloor: 0,
    // Find in Playlist waits above the head until the list is pulled down (unless it's pinned).
    initialScroll: find.initialOffset,
    counter: "playlist",
    onDrop: (_key, from, to) => void reorder(from, to),
  });

  // Recommendations hold their screen position only while some of them are in sight: an Add
  // grows the list above them without pushing them down, and someone reading the rows above
  // (the footer out of sight) sees nothing move.
  const recommendationsTop = useSharedValue(Number.POSITIVE_INFINITY);
  const [anchored, setAnchored] = useState(false);
  useAnimatedReaction(
    () => recommendationsTop.get() < scroll.get() + height.get() - bottomInset,
    (inSight, previous) => {
      if (inSight !== previous) scheduleOnRN(setAnchored, inSight);
    },
    [bottomInset],
  );
  // Suggestions come from YouTube Music radios: with YT Music off there are none.
  const ytMusic = useYtMusicEnabled();
  const recommending = ytMusic && items !== undefined && found === null && !selecting;
  useLayoutEffect(() => {
    recommendationsTop.set(recommending ? lead + shown.length * ROW : Number.POSITIVE_INFINITY);
  }, [recommendationsTop, recommending, lead, shown.length]);

  const onRemove = (item: PlaylistEntryRow) => {
    setOrder((current) => current.filter((row) => row.itemId !== item.itemId));
    void removePlaylistItems(playlistId, [item.itemId]);
  };

  const context = useMemo(
    (): QueueContext => ({ kind: "playlist", id: String(playlistId) }),
    [playlistId],
  );
  const data = useMemo(
    (): readonly Item[] =>
      items === undefined
        ? []
        : [
            ...shown,
            ...(found === null && order.length === 0 ? [EMPTY] : []),
            ...(recommending ? [RECOMMENDATIONS] : []),
          ],
    [items, shown, found, order.length, recommending],
  );
  const song = useCallback((item: Item) => {
    const entry = entryOf(item);
    return entry === null ? null : playlistEntry(entry);
  }, []);
  const selection = useMemo(
    (): SongListSelection<Item> => ({
      selecting,
      isChecked: (item) => {
        const entry = entryOf(item);
        return entry !== null && listSelection.isChecked(entry);
      },
      toggle: (item) => {
        const entry = entryOf(item);
        if (entry !== null && checkable(entry)) listSelection.toggle(entry);
      },
      start: (item) => {
        const entry = entryOf(item);
        if (entry !== null && checkable(entry)) listSelection.start(entry);
      },
      checkable: (item) => {
        const entry = entryOf(item);
        return entry !== null && checkable(entry);
      },
    }),
    [selecting, listSelection],
  );
  const count = shown.length;
  const rowActions = useCallback(
    (_item: Item, index: number): readonly AccessibilityActionInfo[] =>
      selecting || !reorderable
        ? NO_MOVES
        : [...(index > 0 ? [MOVE_UP] : []), ...(index < count - 1 ? [MOVE_DOWN] : [])],
    [selecting, reorderable, count],
  );
  const decorateRow = useCallback(
    (row: ReactElement, item: Item, index: number) => {
      const key = itemKey(item);
      return (
        <DraggableEntry
          row={row as ReactElement<SongRowActions>}
          rowKey={key}
          index={index}
          drag={rowDrag}
          lifted={drag?.key === key}
          grip={!selecting && reorderable}
        />
      );
    },
    [rowDrag, drag, selecting, reorderable],
  );
  const renderSlot = ({ item }: { item: Item }) =>
    "kind" in item ? (
      item.kind === "empty" ? (
        empty
      ) : (
        <PlaylistRecommendations key={playlistId} playlistId={playlistId} items={read} />
      )
    ) : null;

  const swipe = (item: Item, shown: RowMenuAction) => {
    const entry = entryOf(item);
    if (entry === null) return;
    const playlistItem = placeOf(entry);
    if (entry.source === "library")
      runTrackSwipe({ kind: "track", items: [{ song: entry.track, playlistItem }] }, shown);
    else if (entry.source === "stream") runYtSongSwipe(entry.song, shown, { playlistItem });
    else if (entry.source === "unsearched")
      runTrackSwipe({ kind: "track", items: [{ unsearched: entry.song, playlistItem }] }, shown);
    // An unavailable entry's only swipe is Remove from Playlist (`onSongRemove`).
  };
  const menu = (item: Item, options: MenuOptions) => {
    const entry = entryOf(item);
    if (entry === null) return;
    const place = placeOf(entry);
    const withPlace = { ...options, playlistItem: place };
    if (entry.source === "library") openTrackActions(entry.track, withPlace);
    else if (entry.source === "stream") openYtSongActions(entry.song, withPlace);
    else if (entry.source === "unsearched") openUnsearchedActions(entry.song, withPlace);
    else openUnavailableEntryActions(entry.song, place);
  };

  return (
    <FindFrame find={find}>
      <View
        className="flex-1 overflow-hidden"
        onLayout={(event) => height.set(event.nativeEvent.layout.height)}
      >
        <SongList
          animated
          ref={list}
          refScrollView={scrollRef}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          scrollEnabled={scrollable && drag === null}
          scrollEventThrottle={16}
          className="flex-1"
          data={data}
          keyExtractor={itemKey}
          song={song}
          context={context}
          selection={selection}
          // A found song plays the whole playlist from its own place in it.
          onPlay={(item) => {
            const entry = entryOf(item);
            if (entry !== null) playPlaylistEntries(order, places.get(entry), context);
          }}
          onMenu={menu}
          onSongSwipe={swipe}
          onSongRemove={(item) => {
            const entry = entryOf(item);
            if (entry !== null) onRemove(entry);
          }}
          rowActions={rowActions}
          onRowAction={(item, name) => {
            const entry = entryOf(item);
            const index = entry === null ? -1 : orderRef.current.indexOf(entry);
            if (index < 0) return;
            if (name === "moveUp") reorder(index, index - 1);
            else if (name === "moveDown") reorder(index, index + 1);
          }}
          decorateRow={decorateRow}
          renderSlot={renderSlot}
          slotType={slotType}
          slotSize={slotSize}
          extraData={drag}
          alwaysRender={drag === null ? undefined : { keys: [drag.key] }}
          maintainVisibleContentPosition={
            anchored && recommending
              ? { data: true, shouldRestorePosition: (item) => item === RECOMMENDATIONS }
              : undefined
          }
          lifted={
            drag === null
              ? null
              : {
                  key: drag.key,
                  style: [
                    { height: ROW, left: grid.margin, right: grid.margin, backgroundColor: fill },
                    liftedStyle,
                  ],
                  accessory: <Grip shown color={secondary} />,
                }
          }
          contentContainerStyle={{
            paddingHorizontal: grid.margin,
            paddingBottom: bottomInset,
            minHeight: find.minHeight,
          }}
          initialScrollOffset={find.initialOffset}
          ListHeaderComponent={
            <View onLayout={(event) => setLead(event.nativeEvent.layout.height)}>
              <FindHead find={find} header={header} />
            </View>
          }
        />
      </View>
    </FindFrame>
  );
}
