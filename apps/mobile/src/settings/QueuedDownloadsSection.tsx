import {
  moveDownloadGroup,
  moveDownloadInGroup,
  queuedDownloadsSummary,
  type DownloadGroup,
  type QueuedDownload,
} from "@wave/core";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Text, View, type AccessibilityActionEvent } from "react-native";
import type { usePanGesture } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import {
  REORDER_HANDLE_ROOM,
  ReorderHandle,
  useReorderRow,
  useRowReorder,
  type RowReorder,
} from "@/components/RowReorder";
import { TextButton } from "@/components/TextButton";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { DownloadSongRow } from "@/settings/DownloadSongRow";
import { useHoldPageScroll } from "@/settings/SettingsPage";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import {
  cancelQueuedDownload,
  moveQueuedDownloads,
  useDownloadingList,
} from "@/ytmusic/YtDownloads";

type Grip = ReturnType<typeof usePanGesture>;

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

/**
 * One song on its way: its artwork, title and artists, the progress line its row shows
 * elsewhere, Cancel until it's saving to the Library, and a waiting song's drag handle (one
 * downloading now has room for it instead, so the Cancels line up). With hundreds queued, a row
 * only renders again when what it shows changed (its progress line, say), not on every journal
 * change.
 */
const QueuedDownloadRow = memo(
  function QueuedDownloadRow({
    queued,
    covers,
    grip = null,
    handleRoom = false,
    canMoveUp = false,
    canMoveDown = false,
    onAccessibilityAction,
  }: {
    queued: QueuedDownload<NativeYtSong>;
    covers: boolean;
    /** A waiting song's handle. */
    grip?: Grip | null;
    /** Room for a handle, for a song downloading now among waiting ones. */
    handleRoom?: boolean;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  }) {
    const { song, line, cancel } = queued;
    return (
      <DownloadSongRow
        song={song}
        covers={covers}
        line={line}
        accessibilityActions={[
          ...(canMoveUp ? [{ name: "moveUp", label: "Move up" }] : []),
          ...(canMoveDown ? [{ name: "moveDown", label: "Move down" }] : []),
        ]}
        onAccessibilityAction={onAccessibilityAction}
      >
        {cancel !== null && (
          <TextButton label="Cancel" onPress={() => cancelQueuedDownload(queued)} />
        )}
        {grip !== null && <ReorderHandle gesture={grip} />}
        {grip === null && handleRoom && <View style={{ width: REORDER_HANDLE_ROOM }} />}
      </DownloadSongRow>
    );
  },
  (before, after) =>
    before.covers === after.covers &&
    before.queued.song === after.queued.song &&
    before.queued.line === after.queued.line &&
    before.queued.cancel?.join() === after.queued.cancel?.join() &&
    before.grip === after.grip &&
    before.handleRoom === after.handleRoom &&
    before.canMoveUp === after.canMoveUp &&
    before.canMoveDown === after.canMoveDown &&
    before.onAccessibilityAction === after.onAccessibilityAction,
);

/** A waiting song: dragged by its handle within its group, never into another. */
function WaitingDownloadRow({
  queued,
  index,
  count,
  covers,
  reorder,
  move,
}: {
  queued: QueuedDownload<NativeYtSong>;
  index: number;
  count: number;
  covers: boolean;
  reorder: RowReorder<string>;
  move: (from: number, to: number) => void;
}) {
  const { style, handle } = useReorderRow({ index, reorder });
  const onAccessibilityAction = useMoveAction(index, move);
  return (
    <Animated.View
      onLayout={(event) => reorder.measure(queued.id, event.nativeEvent.layout.height)}
      style={style}
    >
      <QueuedDownloadRow
        queued={queued}
        covers={covers}
        grip={handle}
        canMoveUp={index > 0}
        canMoveDown={index < count - 1}
        onAccessibilityAction={onAccessibilityAction}
      />
    </Animated.View>
  );
}

/**
 * A group's header: the playlist, album or mix its songs are from (or Songs), how many are
 * left, and the handle that drags the whole group, its waiting songs with it.
 */
function DownloadGroupHeader({
  group,
  grip,
  index,
  count,
  onAccessibilityAction,
}: {
  group: DownloadGroup<NativeYtSong>;
  grip: Grip;
  index: number;
  count: number;
  onAccessibilityAction: (event: AccessibilityActionEvent) => void;
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
        <ReorderHandle gesture={grip} />
      </View>
      <Hairline />
    </View>
  );
}

/**
 * A group and its waiting songs, which its header drags as one among the groups; each song
 * drags among the group's own.
 */
function DownloadGroupSection({
  group,
  index,
  count,
  covers,
  groups,
  moveGroup,
}: {
  group: DownloadGroup<NativeYtSong>;
  index: number;
  count: number;
  covers: boolean;
  groups: RowReorder<string>;
  moveGroup: (from: number, to: number) => void;
}) {
  const { style, handle } = useReorderRow({ index, reorder: groups });
  const onGroupAction = useMoveAction(index, moveGroup);
  const ids = useMemo(() => group.queued.map((queued) => queued.id), [group.queued]);
  const moveSong = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= group.queued.length) return;
      moveQueuedDownloads(moveDownloadInGroup(group, from, to));
    },
    [group],
  );
  const songs = useRowReorder({ ids, rowHeight: grid.row, move: moveSong });
  useHoldPageScroll(songs.dragging);
  return (
    <Animated.View
      onLayout={(event) => groups.measure(group.key, event.nativeEvent.layout.height)}
      style={style}
    >
      <DownloadGroupHeader
        group={group}
        grip={handle}
        index={index}
        count={count}
        onAccessibilityAction={onGroupAction}
      />
      {group.queued.map((item, songIndex) => (
        <WaitingDownloadRow
          key={item.id}
          queued={item}
          index={songIndex}
          count={group.queued.length}
          covers={covers}
          reorder={songs}
          move={moveSong}
        />
      ))}
    </Animated.View>
  );
}

/**
 * Settings › Downloads, above the failed songs: the Downloading section (Core's
 * `downloadingList`), the songs downloading now first, then the waiting ones grouped by the
 * playlist, album or mix they were asked from, in queue order, under how many of each there are.
 * Dragging a group's header changes which group downloads first; dragging a song changes its
 * order in its group (Core's `moveDownloadGroup` / `moveDownloadInGroup`, which the journal then
 * runs). Nothing while none is.
 */
export function QueuedDownloadsSection() {
  const list = useDownloadingList();
  const { downloading, groups } = list;
  // With YT Music off Wave asks YouTube for nothing, covers included.
  const covers = useYtMusicEnabled();
  const summary = useMemo(
    () => queuedDownloadsSummary([...downloading, ...groups.flatMap((group) => group.queued)]),
    [downloading, groups],
  );
  const keys = useMemo(() => groups.map((group) => group.key), [groups]);
  const moveGroup = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= list.groups.length) return;
      moveQueuedDownloads(moveDownloadGroup(list, from, to));
    },
    [list],
  );
  const groupDrag = useRowReorder({ ids: keys, rowHeight: grid.row * 2, move: moveGroup });
  useHoldPageScroll(groupDrag.dragging);
  if (summary === null) return null;
  return (
    <View>
      <CatalogLine className="mb-1">Downloading</CatalogLine>
      <Text className="mb-2 font-sans text-footnote text-secondary">{summary}</Text>
      <Hairline />
      {downloading.map((item) => (
        <QueuedDownloadRow
          key={item.id}
          queued={item}
          covers={covers}
          handleRoom={groups.length > 0}
        />
      ))}
      {groups.map((group, index) => (
        <DownloadGroupSection
          key={group.key}
          group={group}
          index={index}
          count={groups.length}
          covers={covers}
          groups={groupDrag}
          moveGroup={moveGroup}
        />
      ))}
    </View>
  );
}
