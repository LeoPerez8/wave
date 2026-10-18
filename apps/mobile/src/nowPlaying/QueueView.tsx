import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { IconMenu2, IconRepeat, IconRepeatOnce, IconX } from "@tabler/icons-react-native";
import {
  currentEntry,
  counted,
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
import { Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
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
import { ROW, useUpNextDrag, useUpNextRowDrag, type UpNextDragRows } from "./upNextDrag";
import { upNextScroll } from "./upNextScroll";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const THUMB = CELL * 5;

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

type RowProps = {
  entry: QueueEntry;
  index: number;
  track: QueueTrack | undefined;
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
const UpNextRow = memo(function UpNextRow({ entry, index, track, lifted, drag, count }: RowProps) {
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
});

/**
 * Up Next: tap a row to play it, X to remove it, and drag its handle to move
 * it. Near the list's top or bottom edge a drag scrolls the list.
 *
 * A drag runs on the UI thread (`upNextDrag.ts`): the lifted row follows the
 * finger and the others step aside with no React render per movement or drop
 * target. On drop the lifted copy settles into its slot, then the new order
 * lands in one render with the offsets reset, and stays shown
 * (`withPendingMoves`) until the queue has it.
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

  const onMove = useCallback((move: PendingMove, moved: Promise<void>) => {
    setPending((list) => [...list, move]);
    void moved.finally(() => setPending((list) => list.filter((other) => other !== move)));
  }, []);
  const { drag, rowDrag, liftedStyle, height, scrollRef } = useUpNextDrag({
    shown,
    entries,
    bottomInset,
    onMove,
  });

  // The Queue stays mounted between showings (NowPlayingSheet's `QueuePane`),
  // hidden in an `Activity` that tears this effect down and sets it up again
  // on each showing. Each showing places Up Next through Legend List: a new
  // play's starts from the top, the same play's keeps its place, and the list
  // draws the rows for that offset even if its queue changed out of sight.
  const listRef = useRef<LegendListRef>(null);
  const [placeUpNext] = useState(() => upNextScroll<QueueState["context"]>());
  useLayoutEffect(() => {
    placeUpNext(listRef.current, queue.context);
  }, [placeUpNext, queue.context]);

  const renderItem = useCallback(
    ({ item, index }: { item: QueueEntry; index: number }) => (
      <UpNextRow
        entry={item}
        index={index}
        track={tracks.get(item.trackId)}
        lifted={drag?.key === item.key}
        drag={rowDrag}
        count={entries.length}
      />
    ),
    [tracks, drag, rowDrag, entries.length],
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

  const liftedTrack =
    drag === null
      ? undefined
      : tracks.get(entries.find((entry) => entry.key === drag.key)?.trackId ?? "");

  return (
    <View
      className="flex-1 overflow-hidden"
      onLayout={(event) => {
        // Hidden behind another view, the list may be laid out empty: keep its last height.
        const measured = event.nativeEvent.layout.height;
        if (measured > 0) height.set(measured);
      }}
    >
      <LegendList
        ref={listRef}
        refScrollView={scrollRef}
        className="flex-1"
        data={entries}
        keyExtractor={(entry) => entry.key}
        renderItem={renderItem}
        extraData={rowState}
        estimatedItemSize={ROW}
        alwaysRender={drag === null ? undefined : { keys: [drag.key] }}
        scrollEnabled={drag === null}
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
