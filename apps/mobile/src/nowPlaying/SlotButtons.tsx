import { useLocalisation } from "@/localisation/localisation";
import {
  IconCircleMinus,
  IconDownload,
  IconListNumbers,
  IconPlaylistAdd,
  IconPlus,
  IconQuote,
  IconRepeat,
  IconRepeatOnce,
  IconShare3,
  IconZzz,
} from "@tabler/icons-react-native";
import type { NowPlayingAction, NowPlayingSlot } from "@wave/core";
import { useCallback, type ComponentType } from "react";
import { View, type AccessibilityActionEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { CELL } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import type { Measurable } from "@/motion/measureRect";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { ACTION_ICONS } from "@/playback/actionIcons";
import { cycleRepeat, toggleShuffle } from "@/playback/actions";
import { useQueueRepeat, useQueueShuffle } from "@/playback/hooks";
import { nowPlayingSlotLabel, nowPlayingSlotTitle } from "@/settings/nowPlayingButtons";
import { useThemeColor } from "@/theme/useThemeColor";

import { openChangeSlotMenu, slotEdit, type SlotChange } from "./ChangeSlotMenu";
import { repeatLabel } from "./QueueView";
import { useShuffleControl } from "./ShuffleMenu";
import { SleepTimerButton } from "./SleepTimer";
import { AddToPlaylistButton, DislikeButton, DownloadButton } from "./SongButtons";
import { useSlotDragGesture, type useNowPlayingSlotDrag } from "./slotDrag";
import type { SongMenuSlotAction } from "./songMenuSlots";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/**
 * An icon that toggles something in Now Playing: teal while it's on, graphite
 * otherwise. In a slot, a long press starts edit mode ([change]).
 */
export function ViewToggle({
  icon: Icon,
  label,
  on,
  onPress,
  change,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  on: boolean;
  onPress: () => void;
  change?: SlotChange | undefined;
}) {
  return (
    <IconButton
      {...change}
      icon={Icon}
      label={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      tone={on ? "accent" : "secondary"}
    />
  );
}

/** What the slots' buttons act on: the song playing, the sheet's Lyrics view and its Queue screen. */
export interface SlotContext {
  readonly trackId: string | null;
  readonly ytSong: NativeYtSong | null;
  /** The playing song's title, for the Add to Playlist picker. */
  readonly title: string;
  readonly lyricsShown: boolean;
  readonly toggleLyrics: () => void;
  readonly queueShown: boolean;
  /** Opens the Queue screen, as the swipe and the edge mark do. */
  readonly openQueue: () => void;
  /** Shares the song playing, as its menu's Share does. */
  readonly share: () => void;
  /** Starts edit mode, as a long press on any slot does. */
  readonly edit: () => void;
  /**
   * Runs the playing song's card's Magic Queue, Go to Artist or Go to Album,
   * as the card does (`usePlayingSongMenu`).
   */
  readonly runSongMenu: (action: SongMenuSlotAction) => void;
}

/** Shuffle: teal while on, with the icon and name of the chosen kind of shuffle. */
function ShuffleSlot({ change }: { change: SlotChange }) {
  const { icon, label } = useShuffleControl();
  const on = useQueueShuffle();
  return (
    <ViewToggle
      icon={icon}
      label={label}
      on={on}
      onPress={() => void toggleShuffle()}
      change={change}
    />
  );
}

/** Repeat: off → all → one, teal while on, with the repeat-one glyph on one. */
function RepeatSlot({ change }: { change: SlotChange }) {
  const { strings } = useLocalisation();
  const repeat = useQueueRepeat();
  return (
    <ViewToggle
      change={change}
      icon={repeat === "one" ? IconRepeatOnce : IconRepeat}
      label={repeatLabel(repeat, strings)}
      on={repeat !== "off"}
      onPress={() => void cycleRepeat()}
    />
  );
}

/**
 * Magic Queue, Go to Artist or Go to Album: the playing song's card's entry
 * of the same name, with its icon and label. [off] shows it disabled, where
 * the card doesn't offer it (Core's `nowPlayingSlotShow`).
 */
function SongMenuSlot({
  action,
  off,
  context,
  change,
}: {
  action: SongMenuSlotAction;
  off: boolean;
  context: SlotContext;
  change: SlotChange;
}) {
  const { strings } = useLocalisation();
  return (
    <IconButton
      {...change}
      icon={ACTION_ICONS[action]}
      label={strings.itemActions.labels[action]}
      tone="secondary"
      disabledTone="tertiary"
      disabled={off}
      onPress={() => context.runSongMenu(action)}
    />
  );
}

/**
 * The button slot [slot] of Now Playing holds (0 to 4 for the footer's, then
 * the transport's left and right), for [action]. A tap runs it; a long press
 * starts edit mode. [off] shows it disabled (Dislike while an unsearched
 * entry's search runs, Go to Album on a song without an album).
 */
export function SlotButton({
  action,
  off = false,
  context,
}: {
  action: NowPlayingAction;
  off?: boolean;
  context: SlotContext;
}) {
  const { strings } = useLocalisation();
  const change = slotEdit(context.edit);
  switch (action) {
    case "lyrics":
      return (
        <ViewToggle
          icon={IconQuote}
          label={strings.playbackText.lyrics}
          on={context.lyricsShown}
          onPress={context.toggleLyrics}
          change={change}
        />
      );
    case "queue":
      return (
        <ViewToggle
          icon={IconListNumbers}
          label={strings.playbackText.queue}
          on={context.queueShown}
          onPress={context.openQueue}
          change={change}
        />
      );
    case "sleepTimer":
      return <SleepTimerButton change={change} />;
    case "addToPlaylist":
      return (
        <AddToPlaylistButton
          trackId={context.trackId}
          ytSong={context.ytSong}
          title={context.title}
          change={change}
        />
      );
    case "download":
      return <DownloadButton trackId={context.trackId} ytSong={context.ytSong} change={change} />;
    case "shuffle":
      return <ShuffleSlot change={change} />;
    case "repeat":
      return <RepeatSlot change={change} />;
    case "share":
      return (
        <IconButton
          {...change}
          icon={IconShare3}
          label={strings.playbackText.shareSong}
          tone="secondary"
          onPress={context.share}
        />
      );
    case "dislike":
      return (
        <DislikeButton
          trackId={context.trackId}
          ytSong={context.ytSong}
          off={off}
          change={change}
        />
      );
    case "magicQueue":
    case "goToArtist":
    case "goToAlbum":
      return <SongMenuSlot action={action} off={off} context={context} change={change} />;
  }
}

/**
 * Each action's glyph on its slot in edit mode; Shuffle's is the chosen
 * kind's, and the song menu's entries have the card's icons.
 */
const EDIT_ICONS: Readonly<Record<Exclude<NowPlayingAction, "shuffle">, ComponentType<IconProps>>> =
  {
    lyrics: IconQuote,
    queue: IconListNumbers,
    sleepTimer: IconZzz,
    addToPlaylist: IconPlaylistAdd,
    download: IconDownload,
    repeat: IconRepeat,
    share: IconShare3,
    dislike: IconCircleMinus,
    magicQueue: ACTION_ICONS.magicQueue,
    goToArtist: ACTION_ICONS.goToArtist,
    goToAlbum: ACTION_ICONS.goToAlbum,
  };

/** A slot's place: the size of its button. */
const SLOT = CELL * 6;

/**
 * Slot [slot] in edit mode: outlined, with the glyph of the action it holds
 * ([action]) or a plus while it's empty. A tap opens the card that changes
 * it, anchored here; the action itself doesn't run. The release that drops
 * a drag of it opens nothing.
 */
export function EditSlot({
  slot,
  action,
  drag,
}: {
  slot: number;
  action: NowPlayingSlot;
  drag: ReturnType<typeof useNowPlayingSlotDrag>;
}) {
  const shuffle = useShuffleControl();
  const [foreground, tertiary, accent] = useThemeColor(["foreground", "tertiary", "accent"]);
  // Measured as a drag begins, with the other slots and the sheet.
  const { register } = drag;
  const place = useCallback((view: Measurable | null) => register(slot, view), [register, slot]);
  const gesture = useSlotDragGesture(drag, slot, action);
  const strings = useLocalisation().strings;
  const Icon =
    action === null ? IconPlus : action === "shuffle" ? shuffle.icon : EDIT_ICONS[action];
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View ref={place} style={{ opacity: drag.dragging === slot ? 0 : 1 }}>
        <IconButton
          label={`${nowPlayingSlotTitle(slot)}, ${nowPlayingSlotLabel(action)}`}
          onPressIn={drag.touched}
          onPress={() => {
            if (drag.tapped(slot)) openChangeSlotMenu(slot);
          }}
          opensMenu
          haptic="selection"
          size={SLOT}
          accessibilityActions={
            action === null
              ? []
              : Array.from({ length: 7 }, (_, destination) => destination)
                  .filter((destination) => destination !== slot)
                  .map((destination) => ({
                    name: `moveToSlot${destination}`,
                    label: strings.settings.moveButtonToSlot(nowPlayingSlotTitle(destination)),
                  }))
          }
          onAccessibilityAction={(event: AccessibilityActionEvent) => {
            const destination = Number(event.nativeEvent.actionName.replace("moveToSlot", ""));
            if (Number.isInteger(destination) && destination >= 0 && destination < 7)
              drag.dropped(slot, destination, false);
          }}
          style={{
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: drag.dropTarget === slot ? accent : tertiary,
            borderRadius: CELL * 1.25,
          }}
        >
          <Icon
            size={action === null ? 20 : 24}
            color={action === null ? tertiary : foreground}
            strokeWidth={1.5}
          />
        </IconButton>
      </Animated.View>
    </GestureDetector>
  );
}

/** The held button, rendered above the sheet while its source slot stays outlined. */
export function SlotDragPreview({
  drag,
  action,
}: {
  drag: ReturnType<typeof useNowPlayingSlotDrag>;
  action: NowPlayingSlot;
}) {
  const shuffle = useShuffleControl();
  const [foreground, ground] = useThemeColor(["foreground", "background"]);
  const Icon =
    action === null ? IconPlus : action === "shuffle" ? shuffle.icon : EDIT_ICONS[action];
  const style = useAnimatedStyle(() => ({
    position: "absolute",
    left: 0,
    top: 0,
    width: SLOT,
    height: SLOT,
    transform: [
      { translateX: drag.state.x.get() - SLOT / 2 },
      { translateY: drag.state.y.get() - SLOT / 2 },
    ],
  }));
  return (
    <Animated.View pointerEvents="none" style={[style, { zIndex: 20 }]}>
      <View
        className="items-center justify-center rounded-xl"
        style={{
          width: SLOT,
          height: SLOT,
          backgroundColor: ground,
          borderColor: foreground,
          borderWidth: 1.5,
          opacity: 0.9,
        }}
      >
        <Icon size={action === null ? 20 : 24} color={foreground} strokeWidth={1.5} />
      </View>
    </Animated.View>
  );
}
