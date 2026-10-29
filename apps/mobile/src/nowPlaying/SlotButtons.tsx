import {
  IconDots,
  IconQuote,
  IconRepeat,
  IconRepeatOnce,
  IconShare3,
} from "@tabler/icons-react-native";
import type { NowPlayingAction } from "@wave/core";
import type { ComponentType } from "react";

import { IconButton } from "@/components/IconButton";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { cycleRepeat, toggleShuffle } from "@/playback/actions";
import { openPlayingActions } from "@/playback/ActionsMenu";
import { useQueue } from "@/playback/hooks";

import { slotChange, type SlotChange } from "./ChangeSlotMenu";
import { REPEAT_LABEL } from "./QueueView";
import { useShuffleControl } from "./ShuffleMenu";
import { SleepTimerButton } from "./SleepTimer";
import { AddToPlaylistButton, DownloadButton } from "./SongButtons";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/**
 * An icon that toggles something in Now Playing: teal while it's on, graphite
 * otherwise. In a slot, a long press changes it ([change]).
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

/** What the slots' buttons act on: the song playing and the sheet's Lyrics view. */
export interface SlotContext {
  readonly trackId: string | null;
  readonly ytSong: NativeYtSong | null;
  /** The playing song's title, for the Add to Playlist picker. */
  readonly title: string;
  readonly lyricsShown: boolean;
  readonly toggleLyrics: () => void;
  /** Shares the song playing, as its menu's Share does. */
  readonly share: () => void;
}

/** Shuffle: teal while on, with the icon and name of the chosen kind of shuffle. */
function ShuffleSlot({ change }: { change: SlotChange }) {
  const { icon, label } = useShuffleControl();
  const on = useQueue().shuffle;
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
  const repeat = useQueue().repeat;
  return (
    <ViewToggle
      change={change}
      icon={repeat === "one" ? IconRepeatOnce : IconRepeat}
      label={REPEAT_LABEL[repeat]}
      on={repeat !== "off"}
      onPress={() => void cycleRepeat()}
    />
  );
}

/**
 * The button slot [slot] of Now Playing's bottom row holds (0 for the first),
 * for [action]. A tap runs it; a long press opens the card that changes it.
 * Off, it shows disabled and only long-presses (Core's `nowPlayingSlotShow`).
 */
export function SlotButton({
  slot,
  action,
  off,
  context,
}: {
  slot: number;
  action: NowPlayingAction;
  off: boolean;
  context: SlotContext;
}) {
  const change = slotChange(slot);
  switch (action) {
    case "lyrics":
      return (
        <ViewToggle
          icon={IconQuote}
          label="Lyrics"
          on={context.lyricsShown}
          onPress={context.toggleLyrics}
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
          label="Share Song"
          tone="secondary"
          onPress={context.share}
        />
      );
    case "songMenu":
      return (
        <IconButton
          {...change}
          icon={IconDots}
          label="Song Menu"
          tone="secondary"
          disabled={off}
          opensMenu
          onPress={openPlayingActions}
        />
      );
  }
}
