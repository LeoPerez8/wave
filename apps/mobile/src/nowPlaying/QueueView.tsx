import type { LegendListRef } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { IconMenu2, IconRepeat, IconRepeatOnce, IconX } from "@tabler/icons-react-native";
import {
  currentEntry,
  counted,
  queueHistory,
  upNext,
  upNextMove,
  withPendingMoves,
  type PendingMove,
  type QueueEntry,
  type QueueState,
  type RepeatMode,
} from "@wave/core";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Text, View, useWindowDimensions, type PressableProps } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { artworkUri } from "@/catalog/artworkUri";
import { Artwork } from "@/catalog/Artwork";
import { CatalogLine, SectionHead, SECTION_HEAD } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TrackSkeletons } from "@/catalog/Skeletons";
import { DownloadedIcon } from "@/catalog/TrackRow";
import { RecommendationsFailed } from "@/components/RecommendationsFailed";
import { useMissingSongs } from "@/library/hooks";
import { Press } from "@/motion/Press";
import { IconButton } from "@/components/IconButton";
import { usePerfVisible, useRenderCount } from "@/perf/perf";
import {
  cycleRepeat,
  moveQueueEntry,
  playQueueEntry,
  removeQueueEntry,
  toggleShuffle,
} from "@/playback/actions";
import { openQueuedSongActions } from "@/playback/ActionsMenu";
import { useQueue } from "@/playback/hooks";
import {
  retryMagicBatch,
  useMagicBatchEmptySeed,
  useMagicBatchFailed,
  useMagicBatchLoading,
  useMagicQueueLabel,
} from "@/playback/MagicQueue";
import { queueState } from "@/playback/Queue";
import type { PlaybackState } from "@/playback/Player";
import { queueTrackDownloaded, type QueueTrack } from "@/playback/queueTracks";
import { useThemeColor } from "@/theme/useThemeColor";

import { Background, type GroundColors } from "./Background";
import { useQueueTracks } from "./hooks";
import { useShuffleControl } from "./ShuffleMenu";
import { TrackHeader } from "./TrackHeader";
import { ROW, useUpNextDrag, useUpNextRowDrag, type UpNextDragRows } from "./upNextDrag";
import { upNextEndSpace, upNextScroll } from "./upNextScroll";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const THUMB = CELL * 5;

const thumbUri = (track: QueueTrack | undefined): string | undefined => artworkUri(track);

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
  return (
    <IconButton
      icon={Icon}
      label={label}
      caption={label}
      layout="horizontal"
      iconSize={20}
      tone={on ? "accent" : "secondary"}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLongPress={onLongPress}
      depth={0.04}
      className="flex-1"
      style={{ width: undefined, height: CELL * 6, gap: CELL }}
      captionProps={{ className: `font-sans text-body ${on ? "font-semibold" : ""}` }}
    />
  );
}

const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Repeat",
  all: "Repeat",
  one: "Repeat One",
};

/**
 * The top of the Queue view, pinned over its list: what's playing (small).
 * Sits in the sheet's drag-to-dismiss area.
 */
export function QueueHeader({
  item,
  onShowPlayer,
}: {
  item: NonNullable<PlaybackState["item"]>;
  onShowPlayer: () => void;
}) {
  return (
    <View>
      <TrackHeader item={item} onShowPlayer={onShowPlayer} />
      <Hairline />
    </View>
  );
}

/** The sticky bar's height: the toggles, a hairline and the Up Next heading. */
const BAR = CELL * 11;

/** What the sticky bar draws its slice of the Now Playing ground from. */
type Ground = {
  /** The ground's colours (`useBackgroundColors`). */
  readonly colors: GroundColors;
  /** The list's top on the sheet, where the bar sticks. */
  readonly top: SharedValue<number>;
  /** The list's scroll, and the bar's offset in it. */
  readonly scroll: SharedValue<number>;
  readonly start: SharedValue<number>;
};

/**
 * The ground behind the sticky bar while it sticks: the sheet's gradient
 * where the bar sits, so the rows scrolling under it don't show through.
 * Elsewhere nothing passes under the bar, which shows the sheet's own.
 */
function BarGround({ colors, top, scroll, start }: Ground) {
  const { height } = useWindowDimensions();
  const style = useAnimatedStyle(() => ({
    opacity: scroll.get() > start.get() ? 1 : 0,
    transform: [{ translateY: -top.get() }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute left-0 right-0 top-0"
      style={[{ height }, style]}
    >
      <Background colors={colors} />
    </Animated.View>
  );
}

/**
 * The Queue list's sticky bar, between History and Up Next: the shuffle and
 * repeat toggles (a long press on shuffle opens the shuffle card; it reads
 * Smart Shuffle or Even Shuffle, each with its own icon, while that's chosen), then the Up Next
 * heading ("Magic Queue · from <seed>" over a Magic Queue).
 */
function UpNextBar({ ground }: { ground: Ground }) {
  const queue = useQueue();
  const shuffle = useShuffleControl();
  const count = queue.entries.length - queue.index - 1;
  const magic = useMagicQueueLabel();
  return (
    <View className="overflow-hidden" style={{ height: BAR }}>
      <BarGround {...ground} />
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
      <View className="flex-1 flex-row items-end justify-between" style={{ paddingBottom: CELL }}>
        <CatalogLine className="shrink">{magic ?? "Up next"}</CatalogLine>
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
  /** It has a Library file (`queueTrackDownloaded`). */
  downloaded: boolean;
  /** A History row: secondary title, faded artwork. */
  dimmed?: boolean;
};

/** Thumbnail, title and artist: the part of an Up Next row that a drag lifts. */
function RowText({ track, downloaded, dimmed = false }: RowContentProps) {
  return (
    <>
      <View className={dimmed ? "opacity-45" : undefined}>
        <Artwork uri={thumbUri(track)} size={THUMB} />
      </View>
      <View className="flex-1">
        <Text
          numberOfLines={1}
          className={`font-sans text-body font-medium ${dimmed ? "text-secondary" : "text-foreground"}`}
        >
          {track?.title ?? " "}
        </Text>
        <View className="flex-row items-center" style={{ gap: CELL / 2 }}>
          {downloaded && <DownloadedIcon />}
          <Text numberOfLines={1} className="flex-1 font-sans text-body text-secondary">
            {track?.artist ?? " "}
          </Text>
        </View>
      </View>
    </>
  );
}

/**
 * What an Up Next and a History row's song share: what VoiceOver reads, and
 * the song's menu on a long press or its "Song actions" action. A row's own
 * further [actions] are run by [onAction].
 */
const songPressProps = (
  entry: QueueEntry,
  track: QueueTrack | undefined,
  downloaded: boolean,
  actions: NonNullable<PressableProps["accessibilityActions"]> = [],
  onAction: (name: string) => void = () => {},
): Pick<
  PressableProps,
  "accessibilityLabel" | "accessibilityActions" | "onAccessibilityAction" | "onLongPress"
> => {
  const openMenu = () => openQueuedSongActions(entry.trackId);
  return {
    accessibilityLabel: `${track?.title ?? "Song"}, ${track?.artist ?? ""}${downloaded ? ", downloaded" : ""}`,
    accessibilityActions: [{ name: "longpress", label: "Song actions" }, ...actions],
    onAccessibilityAction: (event) => {
      const action = event.nativeEvent.actionName;
      if (action === "longpress") openMenu();
      else onAction(action);
    },
    onLongPress: openMenu,
  };
};

type RowProps = {
  entry: QueueEntry;
  index: number;
  track: QueueTrack | undefined;
  downloaded: boolean;
  /** The row being dragged leaves a gap; its lifted copy follows the finger. */
  lifted: boolean;
  drag: UpNextDragRows;
  count: number;
};

/**
 * Memoized: Legend List renders every visible row again when the queue's
 * tracks change (a batch of covers landing), and only the rows whose track
 * changed need to.
 */
const UpNextRow = memo(function UpNextRow({
  entry,
  index,
  track,
  downloaded,
  lifted,
  drag,
  count,
}: RowProps) {
  useRenderCount("UpNextRow");
  const secondary = useThemeColor("secondary");
  const key = entry.key;
  const { pan, style } = useUpNextRowDrag(drag, key, index);

  const title = track?.title ?? "Song";
  return (
    <Animated.View style={[{ height: ROW, opacity: lifted ? 0 : 1 }, style]}>
      <View className="flex-1 flex-row items-center">
        <Press
          accessibilityRole="button"
          accessibilityHint="Plays this song now. Long press for song actions"
          {...songPressProps(
            entry,
            track,
            downloaded,
            [
              { name: "remove", label: "Remove from Up Next" },
              ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
              ...(index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
            ],
            (action) => {
              if (action === "remove") removeQueueEntry(key);
              if (action === "moveUp")
                void moveQueueEntry(upNextMove(queueState.get(), key, index - 1));
              if (action === "moveDown")
                void moveQueueEntry(upNextMove(queueState.get(), key, index + 1));
            },
          )}
          onPress={() => playQueueEntry(key)}
          depth={0.015}
          className="flex-1 flex-row items-center self-stretch"
          style={{ gap: CELL * 1.5 }}
        >
          <RowText track={track} downloaded={downloaded} />
        </Press>
        <IconButton
          icon={IconX}
          iconSize={20}
          size={grid.upNextCell}
          tone="secondary"
          label={`Remove ${title} from Up Next`}
          onPress={() => removeQueueEntry(key)}
        />
        <GestureDetector gesture={pan}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="items-center justify-center"
            style={{ width: grid.upNextCell, height: grid.upNextCell }}
          >
            <IconMenu2 size={20} color={secondary} strokeWidth={1.5} />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
});

type HistoryRowProps = {
  entry: QueueEntry;
  track: QueueTrack | undefined;
  downloaded: boolean;
};

/**
 * A History row: an Up Next row's shape, dimmed, with no X and no drag
 * handle. A tap jumps back to it; a long press opens the song's menu.
 */
const HistoryRow = memo(function HistoryRow({ entry, track, downloaded }: HistoryRowProps) {
  useRenderCount("HistoryRow");
  return (
    <Press
      accessibilityRole="button"
      accessibilityHint="Plays this song again. Long press for song actions"
      {...songPressProps(entry, track, downloaded)}
      onPress={() => playQueueEntry(entry.key)}
      depth={0.015}
      className="flex-row items-center"
      style={{ height: ROW, gap: CELL * 1.5 }}
    >
      <RowText track={track} downloaded={downloaded} dimmed />
    </Press>
  );
});

/** Up Next rows' stand-ins while a Magic Queue batch is picked, heard as one busy group. */
function UpNextSkeletons() {
  return <TrackSkeletons trailing="queue" />;
}

/** The Queue list's rows: History under its heading, the sticky bar, then Up Next. */
type QueueRow =
  | { readonly kind: "historyHead" }
  | { readonly kind: "history"; readonly entry: QueueEntry }
  | { readonly kind: "bar" }
  | { readonly kind: "upNext"; readonly entry: QueueEntry; readonly index: number };

const HISTORY_HEAD: QueueRow = { kind: "historyHead" };
const BAR_ROW: QueueRow = { kind: "bar" };

const rowKey = (row: QueueRow): string =>
  row.kind === "history"
    ? `history:${row.entry.key}`
    : row.kind === "upNext"
      ? row.entry.key
      : row.kind;

const rowType = (row: QueueRow): QueueRow["kind"] => row.kind;

const rowSize = (row: QueueRow): number =>
  row.kind === "historyHead" ? SECTION_HEAD : row.kind === "bar" ? BAR : ROW;

/** The Queue list's height when it was last laid out, 0 before it ever was. */
let lastListHeight = 0;

/** The sticky bar's offset in the list: below History and its heading, when there's any. */
const barOffset = (history: number): number => (history === 0 ? 0 : SECTION_HEAD + history * ROW);

/**
 * The Queue's list. History (the entries behind the current one, which
 * Previous steps back through) sits above a sticky bar with the toggles and
 * the Up Next heading, then Up Next. Each showing opens at the start of Up
 * Next, History out of sight above it (`upNextScroll`).
 *
 * History rows play again on a tap, which gives the entries after them back
 * to Up Next. Up Next: tap a row to play it, X to remove it, and drag its
 * handle to move it. Near either edge a drag scrolls the list. A long press
 * on any row opens its song menu.
 *
 * A drag runs on the UI thread (`upNextDrag.ts`): the lifted row follows the
 * finger and the others step aside with no React render per movement or drop
 * target. On drop the lifted copy settles into its slot, then the new order
 * lands in one render with the offsets reset, and stays shown
 * (`withPendingMoves`) until the queue has it.
 *
 * The list is Legend List's Reanimated one: its sticky bar follows the
 * scroll as Reanimated reads it. The plain list's follows a scroll event it
 * builds again whenever the bar's index changes, and a reshuffle emptying
 * History moved the bar to the top as the list scrolled there, so the bar
 * missed that scroll and stayed drawn at History's old height, over Up Next
 * (#706).
 *
 * While a Magic Queue picks its next batch, skeleton rows stand where it will
 * land: in place of "Nothing up next.", or under the songs already in Up
 * Next, which stay put (docs/spec.md, Skeletons).
 *
 * [ground] is the sheet's ground, and [paneTop] where the Queue view sits on
 * the sheet: the sticky bar draws its slice of the ground.
 */
export function UpNextList({
  bottomInset,
  ground,
  paneTop,
}: {
  bottomInset: number;
  ground: GroundColors;
  paneTop: number;
}) {
  useRenderCount("UpNextList");
  usePerfVisible("queue");
  const queue = useQueue();
  const [pending, setPending] = useState<readonly PendingMove[]>([]);
  const shown = useMemo(() => withPendingMoves(queue, pending), [queue, pending]);
  const entries = useMemo(() => upNext(shown), [shown]);
  const history = useMemo(() => queueHistory(shown), [shown]);
  const tracks = useQueueTracks(queue.entries);
  const missingSongs = useMissingSongs();
  const missingIds = useMemo(
    () => new Set(missingSongs.map((song) => String(song.id))),
    [missingSongs],
  );
  const playingKey = currentEntry(queue)?.key ?? null;
  const batchLoading = useMagicBatchLoading();
  const batchFailed = useMagicBatchFailed();
  const emptySeed = useMagicBatchEmptySeed();

  const rows = useMemo(
    (): QueueRow[] => [
      ...(history.length > 0 ? [HISTORY_HEAD] : []),
      ...history.map((entry): QueueRow => ({ kind: "history", entry })),
      BAR_ROW,
      ...entries.map((entry, index): QueueRow => ({ kind: "upNext", entry, index })),
    ],
    [history, entries],
  );
  const barIndex = history.length > 0 ? history.length + 1 : 0;
  const sticky = useMemo(() => [barIndex], [barIndex]);
  const start = barOffset(history.length);
  // Up Next's start can reach the top however short it is: History stays out of sight.
  // The height renders the footer's room (the drag reads it on the UI thread,
  // `height`); a first showing starts from the last one measured, so it opens
  // with the room already there.
  const [listHeight, setListHeight] = useState(lastListHeight);
  const endSpace = upNextEndSpace(listHeight, {
    bar: BAR,
    row: ROW,
    count: entries.length,
    bottomInset,
  });

  const onMove = useCallback((move: PendingMove, moved: Promise<void>) => {
    setPending((list) => [...list, move]);
    void moved.finally(() => setPending((list) => list.filter((other) => other !== move)));
  }, []);
  const { drag, rowDrag, liftedStyle, height, scroll, scrollRef } = useUpNextDrag({
    shown,
    entries,
    bottomInset,
    lead: start + BAR,
    bar: BAR,
    onMove,
  });

  // The sticky bar's slice of the sheet's ground, placed where the bar sits.
  const [listTop, setListTop] = useState(0);
  const groundTop = useSharedValue(0);
  const barStart = useSharedValue(start);
  useLayoutEffect(() => {
    groundTop.set(paneTop + listTop);
    barStart.set(start);
  }, [groundTop, barStart, paneTop, listTop, start]);
  const barGround = useMemo<Ground>(
    () => ({ colors: ground, top: groundTop, scroll, start: barStart }),
    [ground, groundTop, scroll, barStart],
  );

  // The Queue stays mounted between showings (NowPlayingSheet's `QueuePane`),
  // hidden in an `Activity` that tears these effects down and sets them up
  // again on each showing. Each showing places the list at the start of Up
  // Next through Legend List, which draws the rows for that offset even if its
  // queue changed out of sight; while it shows, the place follows History
  // growing or emptying under it.
  const listRef = useRef<LegendListRef>(null);
  const [placement] = useState(() => upNextScroll<QueueState["context"]>());
  useLayoutEffect(() => {
    placement.place(listRef.current, queue.context, start);
  }, [placement, queue.context, start]);
  useLayoutEffect(() => placement.hide, [placement]);

  const renderItem = useCallback(
    ({ item }: { item: QueueRow }) => {
      if (item.kind === "historyHead") return <SectionHead label="History" />;
      if (item.kind === "bar") return <UpNextBar ground={barGround} />;
      const track = tracks.get(item.entry.trackId);
      const downloaded = queueTrackDownloaded(track, missingIds);
      if (item.kind === "history") {
        return <HistoryRow entry={item.entry} track={track} downloaded={downloaded} />;
      }
      return (
        <UpNextRow
          entry={item.entry}
          index={item.index}
          track={track}
          downloaded={downloaded}
          lifted={drag?.key === item.entry.key}
          drag={rowDrag}
          count={entries.length}
        />
      );
    },
    [tracks, missingIds, drag, rowDrag, entries.length, barGround],
  );
  // Legend List re-renders a row only when its item or extraData changes, and a
  // queue picked back up after JS restarted learns its tracks after the first render.
  const rowState = useMemo(() => ({ tracks, missingIds, drag }), [tracks, missingIds, drag]);

  const failure = batchFailed ? (
    <RecommendationsFailed onRetry={retryMagicBatch} style={{ paddingTop: CELL * 2 }} />
  ) : emptySeed !== null ? (
    <RecommendationsFailed
      message={`No songs found like ${emptySeed}.`}
      onRetry={retryMagicBatch}
      style={{ paddingTop: CELL * 2 }}
    />
  ) : null;

  const footer = batchLoading ? (
    <UpNextSkeletons />
  ) : entries.length > 0 ? (
    failure
  ) : (
    <View style={{ paddingTop: CELL * 2 }}>
      {failure ?? (
        <Text className="font-sans text-subheadline text-secondary">
          {playingKey === null ? "Nothing is playing." : "Nothing up next."}
        </Text>
      )}
    </View>
  );

  const liftedTrack =
    drag === null
      ? undefined
      : tracks.get(entries.find((entry) => entry.key === drag.key)?.trackId ?? "");

  return (
    <View
      className="flex-1 overflow-hidden"
      onLayout={(event) => {
        const { y, height: measured } = event.nativeEvent.layout;
        setListTop(y);
        // Hidden behind another view, the list may be laid out empty: keep its last height.
        if (measured > 0) {
          height.set(measured);
          setListHeight(measured);
          lastListHeight = measured;
        }
      }}
    >
      <AnimatedLegendList
        ref={listRef}
        refScrollView={scrollRef}
        className="flex-1"
        data={rows}
        keyExtractor={rowKey}
        getItemType={rowType}
        getFixedItemSize={rowSize}
        renderItem={renderItem}
        extraData={rowState}
        estimatedItemSize={ROW}
        initialScrollOffset={start}
        stickyHeaderIndices={sticky}
        alwaysRender={drag === null ? undefined : { keys: [drag.key] }}
        scrollEnabled={drag === null}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: bottomInset }}
        ListFooterComponent={<View style={{ minHeight: endSpace }}>{footer}</View>}
      />
      {drag !== null && (
        <Animated.View
          pointerEvents="none"
          className="absolute left-0 right-0 top-0 flex-row items-center bg-surface"
          style={[{ height: ROW }, liftedStyle]}
        >
          <View className="flex-1 flex-row items-center" style={{ gap: CELL * 1.5 }}>
            <RowText
              track={liftedTrack}
              downloaded={queueTrackDownloaded(liftedTrack, missingIds)}
            />
          </View>
          <View style={{ width: grid.upNextTrailing }} />
        </Animated.View>
      )}
    </View>
  );
}
