import { useLocalisation } from "@/localisation/localisation";
import type { LegendListRef } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import {
  IconArrowDown,
  IconArrowUp,
  IconMenu2,
  IconRepeat,
  IconRepeatOnce,
  IconX,
} from "@tabler/icons-react-native";
import {
  currentEntry,
  queueHistory,
  upNext,
  upNextMove,
  withPendingMoves,
  type PendingMove,
  type QueueEntry,
  type QueueState,
  type RepeatMode,
  type SongListRowSource,
  type Catalogue,
} from "@wave/core";
import {
  createContext,
  memo,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";

import { CatalogLine, SectionHead, SECTION_HEAD } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TrackSkeletons } from "@/catalog/Skeletons";
import { RecommendationsFailed } from "@/components/RecommendationsFailed";
import { useMissingSongs } from "@/library/hooks";
import { IconButton } from "@/components/IconButton";
import { FLOATING_PILL_ROOM, FloatingPill } from "@/components/FloatingPill";
import { usePerfVisible, useRenderCount } from "@/perf/perf";
import {
  cycleRepeat,
  moveQueueEntry,
  playQueueEntry,
  removeQueueEntry,
  toggleShuffle,
} from "@/playback/actions";
import { openQueuedSongActions } from "@/playback/ActionsMenu";
import { useQueue, useUpNextReshuffles } from "@/playback/hooks";
import {
  retryMagicBatch,
  useMagicBatchEmptySeed,
  useMagicBatchFailed,
  useMagicBatchLoading,
  useMagicQueueLabel,
} from "@/playback/MagicQueue";
import { queueState } from "@/playback/Queue";
import type { PlaybackState } from "@/playback/Player";
import type { QueueTrack } from "@/playback/queueTracks";
import { SongRow } from "@/songs/SongRow";
import { createSongListModel, type SongRowPresentation } from "@/songs/songListModel";
import { useThemeColor } from "@/theme/useThemeColor";

import { Background, type GroundColors } from "./Background";
import { useQueueTracks } from "./hooks";
import { useShuffleControl } from "./ShuffleMenu";
import { TrackHeader } from "./TrackHeader";
import { ROW, useDraggedRow, useRowDrag, type DragRows } from "@/catalog/rowDrag";
import { backToCurrentSong, upNextEndSpace, upNextScroll } from "./upNextScroll";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

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

/** What the repeat toggles say for [mode], in [strings]' language. */
export const repeatLabel = (mode: RepeatMode, strings: Catalogue): string =>
  mode === "one" ? strings.playbackText.repeatOne : strings.playbackText.repeat;

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
 * The sticky bar's ground, handed down to it past the list: Legend List draws
 * a row again only when its item or `extraData` changes, so a prop through
 * `renderItem` kept the colours the bar was first drawn with, an earlier
 * song's, once the song changed (#732).
 */
const BarGroundContext = createContext<Ground | null>(null);

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
function UpNextBar() {
  const { strings } = useLocalisation();
  const ground = use(BarGroundContext);
  const queue = useQueue();
  const shuffle = useShuffleControl();
  const count = queue.entries.length - queue.index - 1;
  const magic = useMagicQueueLabel();
  return (
    <View className="overflow-hidden" style={{ height: BAR }}>
      {ground !== null && <BarGround {...ground} />}
      <View className="flex-row" style={{ gap: CELL }}>
        <Toggle {...shuffle} on={queue.shuffle} onPress={toggleShuffle} />
        <Toggle
          icon={queue.repeat === "one" ? IconRepeatOnce : IconRepeat}
          label={repeatLabel(queue.repeat, strings)}
          on={queue.repeat !== "off"}
          onPress={cycleRepeat}
        />
      </View>
      <Hairline />
      <View className="flex-1 flex-row items-end justify-between" style={{ paddingBottom: CELL }}>
        <CatalogLine className="shrink">{magic ?? strings.playbackText.upNext}</CatalogLine>
        {count > 0 && (
          <Text
            className="font-sans text-footnote text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {strings.playbackText.songCount(count)}
          </Text>
        )}
      </View>
    </View>
  );
}

/** A queue entry's row, as the song row shows it: no star, length or playing mark. */
const queueSource = (
  entry: QueueEntry,
  track: QueueTrack | undefined,
  missingIds: ReadonlySet<string>,
  history: boolean,
): SongListRowSource => ({
  kind: "queue",
  entry: { key: entry.key, trackId: entry.trackId },
  track,
  missing: missingIds.has(entry.trackId),
  history,
});

/**
 * Screen-reader actions Queue rows offer in [strings]' language: an Up Next
 * row's, one list per place it can move to, and a History row's. Built once
 * per language, so rows keep the same lists.
 */
const rowActionsByLanguage = new WeakMap<Catalogue, ReturnType<typeof buildRowActions>>();
const buildRowActions = ({ playbackText: text }: Catalogue) => {
  const songActions = { name: "longpress", label: text.songActions };
  return {
    upNext: new Map(
      [false, true].flatMap((up) =>
        [false, true].map((down) => [
          `${up}:${down}`,
          [
            songActions,
            { name: "remove", label: text.removeFromUpNext },
            ...(up ? [{ name: "moveUp", label: text.moveUp }] : []),
            ...(down ? [{ name: "moveDown", label: text.moveDown }] : []),
          ],
        ]),
      ),
    ),
    history: [songActions],
  };
};
const rowActions = (strings: Catalogue) => {
  let actions = rowActionsByLanguage.get(strings);
  if (actions === undefined) {
    actions = buildRowActions(strings);
    rowActionsByLanguage.set(strings, actions);
  }
  return actions;
};

/** What a Queue row's keyed handlers act on: the entries on screen. */
type QueueRowActions = {
  readonly onPress: (key: string) => void;
  readonly onLongPress: (key: string) => void;
  readonly onAction: (key: string, name: string) => void;
};

type RowProps = {
  shown: SongRowPresentation;
  index: number;
  /** Removing it says the song's title. */
  title: string;
  /** Its place can move up or down: not first, not last. */
  up: boolean;
  down: boolean;
  /** The row being dragged leaves a gap; its lifted copy follows the finger. */
  lifted: boolean;
  drag: DragRows;
  actions: QueueRowActions;
};

/**
 * Up Next's song row with its remove button and drag handle. Memoized:
 * Legend List renders every visible row again when the queue's tracks change
 * (a batch of covers landing) or it grows, and only the rows whose song or
 * place changed need to.
 */
const UpNextRow = memo(function UpNextRow({
  shown,
  index,
  title,
  up,
  down,
  lifted,
  drag,
  actions,
}: RowProps) {
  const { strings } = useLocalisation();
  useRenderCount("UpNextRow");
  const secondary = useThemeColor("secondary");
  const key = shown.rowKey;
  const { pan, style } = useDraggedRow(drag, key, index);
  const accessory = useMemo(
    () => (
      <>
        <IconButton
          icon={IconX}
          iconSize={20}
          size={grid.upNextCell}
          tone="secondary"
          label={strings.playbackText.removeValueFromUpNext(title)}
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
      </>
    ),
    [title, key, pan, secondary, strings],
  );
  return (
    <Animated.View style={[{ height: ROW, opacity: lifted ? 0 : 1 }, style]}>
      <SongRow
        {...shown}
        onPress={actions.onPress}
        onLongPress={actions.onLongPress}
        extraActions={rowActions(strings).upNext.get(`${up}:${down}`)}
        onExtraAction={actions.onAction}
        accessibilityHint={strings.playbackText.playsThisSongNowLongPressForSongActions}
        accessory={accessory}
      />
    </Animated.View>
  );
});

/**
 * A History row: an Up Next row's song, its cover and title faded, with no X
 * and no drag handle. A tap jumps back to it; a long press opens the song's menu.
 */
const HistoryRow = memo(function HistoryRow({
  shown,
  actions,
}: {
  shown: SongRowPresentation;
  actions: QueueRowActions;
}) {
  const { strings } = useLocalisation();
  useRenderCount("HistoryRow");
  return (
    <SongRow
      {...shown}
      onPress={actions.onPress}
      onLongPress={actions.onLongPress}
      extraActions={rowActions(strings).history}
      onExtraAction={actions.onAction}
      accessibilityHint={strings.playbackText.playsThisSongAgainLongPressForSongActions}
    />
  );
});

/** The lifted copy only follows the finger. */
const ignore = (): void => undefined;

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
 * A drag runs on the UI thread (`catalog/rowDrag.ts`): the lifted row follows the
 * finger and the others step aside with no React render per movement or drop
 * target. On drop the lifted copy settles into its slot, then the new order
 * lands in one render with the offsets reset, and stays shown
 * (`withPendingMoves`) until the queue has it.
 *
 * The list is Legend List's Reanimated one: its sticky bar follows the
 * scroll as Reanimated reads it. The plain list's follows a scroll event it
 * builds again whenever the bar's index changes, and a reshuffle that
 * emptied History (as one did before #797) moved the bar to the top as the
 * list scrolled there, so the bar missed that scroll and stayed drawn at
 * History's old height, over Up Next (#706).
 *
 * Scrolled into History, or more than a screen down Up Next, a pill over the
 * list's bottom brings back the start of Up Next (`FloatingPill`); the
 * list's end leaves room for it, so the last row can scroll clear of it.
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
  const { language, strings } = useLocalisation();
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
  // Under the last row, room for the Back to Current Song pill too.
  const endInset = bottomInset + FLOATING_PILL_ROOM;
  const endSpace = upNextEndSpace(listHeight, {
    bar: BAR,
    row: ROW,
    count: entries.length,
    bottomInset: endInset,
  });

  const onMove = useCallback((move: PendingMove, moved: Promise<void>) => {
    setPending((list) => [...list, move]);
    void moved.finally(() => setPending((list) => list.filter((other) => other !== move)));
  }, []);
  const keys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const { drag, rowDrag, liftedStyle, height, scroll, scrollRef } = useRowDrag({
    keys,
    bottomInset: endInset,
    // Up Next opens at its start under the bar, which History scrolls no lower than.
    lead: start + BAR,
    bar: BAR,
    keepLifted: true,
    scrollFloor: start,
    initialScroll: start,
    counter: "upNext",
    onDrop: (key, _from, to) => {
      // Named by its neighbours, so a track change before the queue takes it keeps the order.
      const move = upNextMove(shown, key, to);
      onMove(move, moveQueueEntry(move));
    },
  });

  // Rows act through keyed handlers that read the entries on screen when they run.
  const onScreen = useRef({ entries, shown });
  useLayoutEffect(() => {
    onScreen.current = { entries, shown };
  });
  const actions = useMemo<QueueRowActions>(() => {
    const trackOf = (key: string) =>
      queueState.get().entries.find((entry) => entry.key === key)?.trackId ??
      onScreen.current.shown.entries.find((entry) => entry.key === key)?.trackId;
    const openMenu = (key: string) => {
      const trackId = trackOf(key);
      if (trackId !== undefined) openQueuedSongActions(trackId);
    };
    return {
      onPress: playQueueEntry,
      onLongPress: openMenu,
      onAction: (key, name) => {
        const index = onScreen.current.entries.findIndex((entry) => entry.key === key);
        if (name === "longpress") openMenu(key);
        else if (name === "remove") removeQueueEntry(key);
        else if (name === "moveUp")
          void moveQueueEntry(upNextMove(queueState.get(), key, index - 1));
        else if (name === "moveDown")
          void moveQueueEntry(upNextMove(queueState.get(), key, index + 1));
      },
    };
  }, []);
  const [model] = useState(createSongListModel);

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
  // growing or emptying under it. A shuffle toggle, or a kind chosen on the
  // shuffle card (the one already chosen too), reorders Up Next with History
  // as it was: the list goes back to Up Next's start, from wherever it was
  // scrolled. It counts the reorders as they land, not the shuffle setting,
  // so a kind synced in from another device doesn't move the list.
  const listRef = useRef<LegendListRef>(null);
  const [placement] = useState(() => upNextScroll<QueueState["context"]>());
  const reshuffles = useUpNextReshuffles();
  useLayoutEffect(() => {
    placement.place(listRef.current, queue.context, start, reshuffles);
  }, [placement, queue.context, start, reshuffles]);
  useLayoutEffect(() => placement.hide, [placement]);

  // The Back to Current Song pill follows the scroll on the UI thread, and a
  // tap scrolls to where each showing opens. Hidden, the Queue drops it: the
  // next showing opens at the start of Up Next. Until the list reports a
  // scroll after a showing, the scroll is where it was when it hid, so the
  // pill waits for the showing's placement (`shownFrom`) rather than blink.
  const [pill, setPill] = useState<"up" | "down" | null>(null);
  const shownFrom = useSharedValue<number | null>(null);
  useLayoutEffect(() => {
    scheduleOnUI(() => {
      shownFrom.set(scroll.get());
    });
    return () => setPill(null);
  }, [shownFrom, scroll]);
  useAnimatedReaction(
    () => scroll.get(),
    (now) => {
      if (shownFrom.get() !== null && now !== shownFrom.get()) shownFrom.set(null);
    },
  );
  useAnimatedReaction(
    () => backToCurrentSong(scroll.get(), barStart.get(), height.get(), shownFrom.get()),
    (now, before) => {
      if (now !== before) scheduleOnRN(setPill, now);
    },
  );
  const reduceMotion = useReducedMotion();
  const backToStart = useCallback(() => {
    void listRef.current?.scrollToOffset({ offset: start, animated: !reduceMotion });
  }, [start, reduceMotion]);

  const renderItem = useCallback(
    ({ item }: { item: QueueRow }) => {
      if (item.kind === "historyHead") return <SectionHead label={strings.playbackText.history} />;
      if (item.kind === "bar") return <UpNextBar />;
      const track = tracks.get(item.entry.trackId);
      const played = item.kind === "history";
      const row = model.row(
        queueSource(item.entry, track, missingIds, played),
        { language },
        item.entry.key,
      );
      if (played) return <HistoryRow shown={row} actions={actions} />;
      return (
        <UpNextRow
          shown={row}
          index={item.index}
          title={track?.title ?? strings.playbackText.song}
          up={item.index > 0}
          // Only the last row's changes as Up Next grows or shrinks.
          down={item.index < entries.length - 1}
          lifted={drag?.key === item.entry.key}
          drag={rowDrag}
          actions={actions}
        />
      );
    },
    [tracks, missingIds, drag, rowDrag, entries.length, model, actions, strings, language],
  );
  // Legend List re-renders a row only when its item or extraData changes, and a
  // queue picked back up after JS restarted learns its tracks after the first render.
  const rowState = useMemo(() => ({ tracks, missingIds, drag }), [tracks, missingIds, drag]);

  const failure = batchFailed ? (
    <RecommendationsFailed onRetry={retryMagicBatch} style={{ paddingTop: CELL * 2 }} />
  ) : emptySeed !== null ? (
    <RecommendationsFailed
      message={strings.playbackText.noSongsFoundLikeValue(emptySeed)}
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
          {playingKey === null
            ? strings.playbackText.nothingIsPlaying
            : strings.playbackText.nothingUpNext}
        </Text>
      )}
    </View>
  );

  const liftedEntry = drag === null ? undefined : entries.find((entry) => entry.key === drag.key);
  const lifted =
    liftedEntry === undefined
      ? null
      : model.row(
          queueSource(liftedEntry, tracks.get(liftedEntry.trackId), missingIds, false),
          { language },
          liftedEntry.key,
        );

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
      <BarGroundContext value={barGround}>
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
          recycleItems
          alwaysRender={drag === null ? undefined : { keys: [drag.key] }}
          scrollEnabled={drag === null}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: endInset }}
          ListFooterComponent={<View style={{ minHeight: endSpace }}>{footer}</View>}
        />
      </BarGroundContext>
      {pill !== null && drag === null && (
        <FloatingPill
          icon={pill === "up" ? IconArrowUp : IconArrowDown}
          label={strings.playbackText.currentSong}
          accessibilityLabel={strings.playbackText.backToCurrentSong}
          bottom={bottomInset}
          onPress={backToStart}
        />
      )}
      {drag !== null && (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute left-0 right-0 top-0 flex-row items-center bg-surface"
          style={[{ height: ROW }, liftedStyle]}
        >
          <View className="flex-1">
            {lifted !== null && <SongRow {...lifted} onPress={ignore} />}
          </View>
          <View style={{ width: grid.upNextTrailing }} />
        </Animated.View>
      )}
    </View>
  );
}
