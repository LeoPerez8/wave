import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import {
  downloadListRows,
  failedDownloadRows,
  queuedDownloadsSummary,
  reorderShift,
  type DownloadGroup,
  type DownloadHeaderRow,
  type DownloadListRow,
  type FailedListRow,
  type QueuedDownload,
  type WaitingSongRow,
} from "@wave/core";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Text, View, type AccessibilityActionEvent } from "react-native";
import type { usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { REORDER_HANDLE_ROOM, ReorderHandle } from "@/components/RowReorder";
import { PlainTextButton } from "@/components/PlainTextButton";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { DownloadSongRow } from "@/settings/DownloadSongRow";
import {
  DOWNLOAD_ROW_ESTIMATE,
  useDownloadsDrag,
  useDragGrip,
  type DownloadDrag,
  type DownloadRowDrag,
} from "@/settings/downloadsDrag";
import { SECTION_GAP } from "@/settings/SettingsPage";
import {
  FailedDownloadRow,
  FailedGroupHeader,
  FailedSectionHeader,
} from "@/settings/FailedDownloadsSection";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import {
  cancelQueuedDownload,
  useDownloadingList,
  useFailedDownloads,
} from "@/ytmusic/YtDownloads";
import { useYoutubePauseNotice } from "@/ytmusic/youtubeThrottle";

type Grip = ReturnType<typeof usePanGesture>;
/** A row's handle: one to drag it by, one only drawn (a lifted copy), or room for one. */
type Handle = Grip | "drawn" | "room";

/** Screen readers' Move up / Move down, for a row that has a place above or below it. */
const moveActions = (index: number, count: number) => [
  ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
  ...(index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
];

/**
 * A row's Move up / Move down, as a callback that stays the same while the row's place and
 * its list change under it (so a memoised row needn't render again for it).
 */
const useMoveAction = (index: number, move: (from: number, to: number) => void) => {
  const latest = useRef({ index, move });
  useLayoutEffect(() => {
    latest.current = { index, move };
  });
  return useCallback((event: AccessibilityActionEvent) => {
    const { index: from, move: moveNow } = latest.current;
    if (event.nativeEvent.actionName === "moveUp") moveNow(from, from - 1);
    if (event.nativeEvent.actionName === "moveDown") moveNow(from, from + 1);
  }, []);
};

function HandleSlot({ handle }: { handle: Handle }) {
  if (handle === "room") return <View style={{ width: REORDER_HANDLE_ROOM }} />;
  return <ReorderHandle gesture={handle === "drawn" ? undefined : handle} />;
}

/** Two songs on their way show the same: the song, its progress line and its Cancel. */
const sameQueued = (a: QueuedDownload<NativeYtSong>, b: QueuedDownload<NativeYtSong>) =>
  a.song === b.song && a.line === b.line && a.cancel?.join() === b.cancel?.join();

/** Two group headers show the same name and line. */
const sameGroupLine = (a: DownloadGroup<NativeYtSong>, b: DownloadGroup<NativeYtSong>) =>
  a.name === b.name && a.line === b.line;

/**
 * One song on its way: its artwork, title and artists, the progress line its row shows
 * elsewhere, Cancel until it's saving to the Library, and a waiting song's drag handle (one
 * downloading now has room for it instead, so the Cancels line up). A row only renders again
 * when what it shows changed (its progress line, say), not on every journal change.
 */
const QueuedDownloadRow = memo(
  function QueuedDownloadRow({
    queued,
    covers,
    handle,
    index = 0,
    count = 1,
    onAccessibilityAction,
  }: {
    queued: QueuedDownload<NativeYtSong>;
    covers: boolean;
    handle: Handle;
    /** A waiting song's place in its group, for Move up / Move down. */
    index?: number;
    count?: number;
    onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  }) {
    const { song, line, cancel } = queued;
    return (
      <DownloadSongRow
        song={song}
        covers={covers}
        line={line}
        accessibilityActions={onAccessibilityAction === undefined ? [] : moveActions(index, count)}
        onAccessibilityAction={onAccessibilityAction}
      >
        {cancel !== null && (
          <PlainTextButton label="Cancel" onPress={() => cancelQueuedDownload(queued)} />
        )}
        <HandleSlot handle={handle} />
      </DownloadSongRow>
    );
  },
  (before, after) =>
    before.covers === after.covers &&
    sameQueued(before.queued, after.queued) &&
    before.handle === after.handle &&
    before.index === after.index &&
    before.count === after.count &&
    before.onAccessibilityAction === after.onAccessibilityAction,
);

/**
 * A group's header: the playlist, album or mix its songs are from (or Songs), how many are
 * left, and the handle that drags the whole group, its waiting songs with it. A group whose
 * songs have all started has nothing to move: no handle (room for one, so the counts line up)
 * and no Move up / Move down.
 */
function DownloadGroupHeader({
  group,
  handle,
  index = 0,
  count = 1,
  onAccessibilityAction,
}: {
  group: DownloadGroup<NativeYtSong>;
  handle: Handle;
  index?: number;
  count?: number;
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}) {
  return (
    <View>
      <View className="flex-row items-center" style={{ gap: CELL * 1.5, paddingTop: CELL }}>
        <View
          className="flex-1 flex-row items-baseline"
          style={{ gap: CELL * 1.5 }}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${group.name}, ${group.line}`}
          accessibilityActions={moveActions(index, count)}
          onAccessibilityAction={onAccessibilityAction}
        >
          <Text
            numberOfLines={1}
            className="flex-1 font-sans text-body font-semibold text-foreground"
          >
            {group.name}
          </Text>
          <Text
            className="font-sans text-footnote text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {group.line}
          </Text>
        </View>
        <HandleSlot handle={handle} />
      </View>
      <Hairline />
    </View>
  );
}

/**
 * A row stepping aside while what it's part of is passed: a song by another song of its group
 * ([index]: its place among them), a group's header or song by another group ([index]: its
 * group's place among the groups that move).
 */
function SteppingAside({
  index,
  rowDrag: { from, to, step },
  children,
}: {
  index: number;
  rowDrag: DownloadRowDrag;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const dragged = from.get();
    const shift = dragged === -1 ? 0 : reorderShift({ index, from: dragged, to: to.get() });
    return { transform: [{ translateY: shift * step.get() }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** A dragged row's place in the list (a dragged group's songs too): hidden, as its lifted copy moves. */
const LIFTED = { opacity: 0 } as const;

/** [content], stepping aside as [stepsAs] when that's a place, else as it is. */
function MaybeSteppingAside({
  stepsAs,
  rowDrag,
  children,
}: {
  stepsAs: number | null;
  rowDrag: DownloadRowDrag;
  children: ReactElement;
}) {
  return stepsAs === null ? (
    children
  ) : (
    <SteppingAside index={stepsAs} rowDrag={rowDrag}>
      {children}
    </SteppingAside>
  );
}

/**
 * A waiting song, dragged by its handle within its group, never into another. A plain view,
 * except while a song of its group, or a group, is dragged past it.
 */
const WaitingDownloadRow = memo(
  function WaitingDownloadRow({
    row,
    covers,
    lifted,
    stepsAs,
    rowDrag,
    moveSong,
  }: {
    row: WaitingSongRow<NativeYtSong>;
    covers: boolean;
    /** Being dragged, or its group is: the lifted copy shows instead. */
    lifted: boolean;
    /** The place it steps aside as while another song of its group, or a group, is dragged; else null. */
    stepsAs: number | null;
    rowDrag: DownloadRowDrag;
    moveSong: (groupKey: string, from: number, to: number) => void;
  }) {
    const view = useRef<ComponentRef<typeof View>>(null);
    const grip = useDragGrip(rowDrag, { kind: "song", key: row.key, groupKey: row.groupKey }, view);
    const onAccessibilityAction = useMoveAction(row.index, (from, to) =>
      moveSong(row.groupKey, from, to),
    );
    const content = (
      <View ref={view} collapsable={false} style={lifted ? LIFTED : undefined}>
        <QueuedDownloadRow
          queued={row.queued}
          covers={covers}
          handle={grip}
          index={row.index}
          count={row.count}
          onAccessibilityAction={onAccessibilityAction}
        />
      </View>
    );
    return (
      <MaybeSteppingAside stepsAs={stepsAs} rowDrag={rowDrag}>
        {content}
      </MaybeSteppingAside>
    );
  },
  (before, after) =>
    before.covers === after.covers &&
    before.lifted === after.lifted &&
    before.stepsAs === after.stepsAs &&
    before.rowDrag === after.rowDrag &&
    before.moveSong === after.moveSong &&
    before.row.key === after.row.key &&
    before.row.groupKey === after.row.groupKey &&
    before.row.index === after.row.index &&
    before.row.count === after.row.count &&
    sameQueued(before.row.queued, after.row.queued),
);

/**
 * A header of a group with waiting songs: its handle drags the whole group among the others,
 * which step aside for it (its songs hidden in place while its lifted header moves).
 */
const MovableGroupHeader = memo(
  function MovableGroupHeader({
    row,
    lifted,
    steps,
    rowDrag,
    moveGroup,
  }: {
    row: DownloadHeaderRow<NativeYtSong>;
    lifted: boolean;
    /** Another group is being dragged. */
    steps: boolean;
    rowDrag: DownloadRowDrag;
    moveGroup: (from: number, to: number) => void;
  }) {
    const view = useRef<ComponentRef<typeof View>>(null);
    const grip = useDragGrip(
      rowDrag,
      { kind: "group", key: row.key, groupKey: row.group.key },
      view,
    );
    const onAccessibilityAction = useMoveAction(row.index, moveGroup);
    return (
      <MaybeSteppingAside stepsAs={steps ? row.index : null} rowDrag={rowDrag}>
        <View ref={view} collapsable={false} style={lifted ? LIFTED : undefined}>
          <DownloadGroupHeader
            group={row.group}
            handle={grip}
            index={row.index}
            count={row.count}
            onAccessibilityAction={onAccessibilityAction}
          />
        </View>
      </MaybeSteppingAside>
    );
  },
  (before, after) =>
    before.lifted === after.lifted &&
    before.steps === after.steps &&
    before.rowDrag === after.rowDrag &&
    before.moveGroup === after.moveGroup &&
    before.row.key === after.row.key &&
    before.row.index === after.row.index &&
    before.row.count === after.row.count &&
    sameGroupLine(before.row.group, after.row.group),
);

/** The header of a group whose songs have all started: nothing to drag. */
const StartedGroupHeader = memo(
  function StartedGroupHeader({ group }: { group: DownloadGroup<NativeYtSong> }) {
    return <DownloadGroupHeader group={group} handle="room" />;
  },
  (before, after) => sameGroupLine(before.group, after.group),
);

/** The dragged row as it lifts over the list: on the fill colour, under the finger. */
function LiftedCopy({
  drag,
  rows,
  covers,
}: {
  drag: DownloadDrag;
  rows: readonly DownloadListRow<NativeYtSong>[];
  covers: boolean;
}) {
  const row = rows.find((each) => each.key === drag.key);
  if (row === undefined || row.kind === "downloading" || row.kind === "startedHeader") return null;
  return row.kind === "header" ? (
    <DownloadGroupHeader group={row.group} handle="drawn" />
  ) : (
    <QueuedDownloadRow queued={row.queued} covers={covers} handle="drawn" />
  );
}

/** A row of the page's list: the songs on their way (and their groups), then the failed section. */
type PageRow = DownloadListRow<NativeYtSong> | FailedListRow<NativeYtSong>;

const keyOf = (row: PageRow) => row.key;
const typeOf = (row: PageRow) => row.kind;

/**
 * Settings › Downloads as one virtualized list (as the Library's song lists are): [header]
 * (the download settings) above, then the Downloading section (Core's `downloadingList`), the
 * songs downloading now first, then the waiting ones grouped by the playlist, album or mix
 * they were asked from, in queue order, under how many of each there are; then the failed
 * songs, collapsed to how many with Retry All until shown, then grouped by why they failed.
 * Groups and songs, waiting or failed, are rows of the list (Core's `downloadListRows`,
 * `failedDownloadRows`), so only the rows around the screen are mounted however long the
 * queue is or however many failed. Dragging a group's header
 * changes which group downloads first; dragging a song changes its order in its group (Core's
 * `moveDownloadGroup` / `moveDownloadInGroup`, which the journal then runs; `downloadsDrag.ts`).
 */
export function DownloadsList({ header }: { header: ReactElement }) {
  const list = useDownloadingList();
  const failed = useFailedDownloads();
  const [failedShown, setFailedShown] = useState(false);
  const toggleFailed = useCallback(() => setFailedShown((shown) => !shown), []);
  // With YT Music off Wave asks YouTube for nothing, covers included.
  const covers = useYtMusicEnabled();
  const rows = useMemo(() => downloadListRows(list), [list]);
  const failedRows = useMemo(
    () => failedDownloadRows(failed, { expanded: failedShown }),
    [failed, failedShown],
  );
  const pageRows = useMemo<readonly PageRow[]>(
    () => (failedRows.length === 0 ? rows : [...rows, ...failedRows]),
    [rows, failedRows],
  );
  const summary = useMemo(() => queuedDownloadsSummary(list.counts), [list]);
  const pauseNotice = useYoutubePauseNotice();
  const listRef = useRef<LegendListRef>(null);
  const { drag, rowDrag, moveSong, moveGroup, liftedStyle, scrollRef, container, onLayout } =
    useDownloadsDrag({ list, rows, listRef });

  const renderItem = useCallback(
    ({ item }: { item: PageRow }) => {
      if (item.kind === "failedHeader") {
        return <FailedSectionHeader row={item} failed={failed} onToggle={toggleFailed} />;
      }
      if (item.kind === "failedGroup") return <FailedGroupHeader row={item} />;
      if (item.kind === "failedSong") {
        return <FailedDownloadRow failed={item.failed} covers={covers} />;
      }
      if (item.kind === "downloading") {
        return <QueuedDownloadRow queued={item.queued} covers={covers} handle="room" />;
      }
      if (item.kind === "startedHeader") return <StartedGroupHeader group={item.group} />;
      const groupDragged = drag?.kind === "group" ? drag.groupKey : null;
      if (item.kind === "header") {
        return (
          <MovableGroupHeader
            row={item}
            lifted={drag?.key === item.key}
            steps={groupDragged !== null && groupDragged !== item.group.key}
            rowDrag={rowDrag}
            moveGroup={moveGroup}
          />
        );
      }
      const ownGroupDragged = groupDragged === item.groupKey;
      const stepsAs =
        drag?.kind === "song" && drag.groupKey === item.groupKey && drag.key !== item.key
          ? item.index
          : groupDragged !== null && !ownGroupDragged
            ? item.groupIndex
            : null;
      return (
        <WaitingDownloadRow
          row={item}
          covers={covers}
          lifted={drag?.key === item.key || ownGroupDragged}
          stepsAs={stepsAs}
          rowDrag={rowDrag}
          moveSong={moveSong}
        />
      );
    },
    [covers, drag, rowDrag, moveSong, moveGroup, failed, toggleFailed],
  );
  // Legend List renders a row again only when its item or extraData changes.
  const rowState = useMemo(() => ({ covers, drag, failed }), [covers, drag, failed]);

  const listHeader = (
    <View style={{ gap: SECTION_GAP }}>
      {header}
      {summary !== null && (
        <View>
          <CatalogLine className="mb-1">Downloading</CatalogLine>
          <Text className="mb-2 font-sans text-footnote text-secondary">{summary}</Text>
          {pauseNotice !== null && (
            <Text
              accessibilityLiveRegion="polite"
              className="mb-2 font-sans text-footnote text-foreground"
            >
              {pauseNotice}
            </Text>
          )}
          <Hairline />
        </View>
      )}
    </View>
  );

  return (
    <View
      ref={container}
      collapsable={false}
      className="flex-1"
      onLayout={(event) => onLayout(event.nativeEvent.layout.height)}
    >
      <LegendList
        ref={listRef}
        refScrollView={scrollRef}
        className="flex-1"
        data={pageRows}
        keyExtractor={keyOf}
        getItemType={typeOf}
        renderItem={renderItem}
        extraData={rowState}
        estimatedItemSize={DOWNLOAD_ROW_ESTIMATE}
        recycleItems={false}
        // The dragged row stays mounted however far auto-scroll takes the list: its handle holds the drag.
        alwaysRender={drag === null ? undefined : { keys: [drag.key] }}
        scrollEnabled={drag === null}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: SECTION_GAP }}
        ListHeaderComponent={listHeader}
      />
      {drag !== null && (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute top-0 bg-fill"
          style={[{ left: grid.margin, right: grid.margin }, liftedStyle]}
        >
          <LiftedCopy drag={drag} rows={rows} covers={covers} />
        </Animated.View>
      )}
    </View>
  );
}
