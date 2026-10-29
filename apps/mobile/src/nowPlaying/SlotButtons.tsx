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

import { REPEAT_LABEL } from "./QueueView";
import { useShuffleControl } from "./ShuffleMenu";
import { SleepTimerButton } from "./SleepTimer";
import { AddToPlaylistButton, DownloadButton } from "./SongButtons";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** An icon that toggles something in Now Playing: teal while it's on, graphite otherwise. */
export function ViewToggle({
  icon: Icon,
  label,
  on,
  onPress,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <IconButton
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

/** The actions that need a song on to show: with nothing playing their slots stay empty. */
const NEEDS_SONG: ReadonlySet<NowPlayingAction> = new Set([
  "addToPlaylist",
  "download",
  "share",
  "songMenu",
]);

/** Whether [action]'s button shows, given whether a song is on. */
export const slotShows = (action: NowPlayingAction, songOn: boolean): boolean =>
  songOn || !NEEDS_SONG.has(action);

/** Shuffle: teal while on, with the icon and name of the chosen kind of shuffle. */
function ShuffleSlot() {
  const { icon, label } = useShuffleControl();
  const on = useQueue().shuffle;
  return <ViewToggle icon={icon} label={label} on={on} onPress={() => void toggleShuffle()} />;
}

/** Repeat: off → all → one, teal while on, with the repeat-one glyph on one. */
function RepeatSlot() {
  const repeat = useQueue().repeat;
  return (
    <ViewToggle
      icon={repeat === "one" ? IconRepeatOnce : IconRepeat}
      label={REPEAT_LABEL[repeat]}
      on={repeat !== "off"}
      onPress={() => void cycleRepeat()}
    />
  );
}

/** The button a slot of Now Playing's bottom row holds, for [action]. */
export function SlotButton({
  action,
  context,
}: {
  action: NowPlayingAction;
  context: SlotContext;
}) {
  switch (action) {
    case "lyrics":
      return (
        <ViewToggle
          icon={IconQuote}
          label="Lyrics"
          on={context.lyricsShown}
          onPress={context.toggleLyrics}
        />
      );
    case "sleepTimer":
      return <SleepTimerButton />;
    case "addToPlaylist":
      return (
        <AddToPlaylistButton
          trackId={context.trackId}
          ytSong={context.ytSong}
          title={context.title}
        />
      );
    case "download":
      return <DownloadButton trackId={context.trackId} ytSong={context.ytSong} />;
    case "shuffle":
      return <ShuffleSlot />;
    case "repeat":
      return <RepeatSlot />;
    case "share":
      return (
        <IconButton icon={IconShare3} label="Share Song" tone="secondary" onPress={context.share} />
      );
    case "songMenu":
      return (
        <IconButton
          icon={IconDots}
          label="Song Menu"
          tone="secondary"
          opensMenu
          onPress={openPlayingActions}
        />
      );
  }
}
