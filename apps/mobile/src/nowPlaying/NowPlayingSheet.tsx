import { activeTiming, beginTiming, timingSurfaceCommitted } from "@/lib/timing";
import {
  IconChevronDown,
  IconListNumbers,
  IconQuote,
  IconShare3,
} from "@tabler/icons-react-native";
import type { ComponentType, ReactNode } from "react";
import {
  Activity,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, type DerivedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { CoveredByNowPlaying } from "@/lib/screenSight";
import { Press } from "@/motion/Press";
import { addScreenBackHandler } from "@/overlay/back";
import { useRenderCount } from "@/perf/perf";
import type { TrackDetails } from "@/library/LibraryStore";
import { useCurrentTrackId } from "@/playback/hooks";
import { playbackState, type PlaybackState } from "@/playback/Player";
import { LyricCardLayer } from "@/share/LyricCardPreview";
import { useLyricCardShown } from "@/share/lyricCard";
import { useSongShareShown } from "@/share/songShare";
import { shareNowPlaying } from "@/share/songShare";
import { useThemeColor } from "@/theme/useThemeColor";

import { Background, useBackgroundColors } from "./Background";
import { DismissArea } from "./DismissArea";
import {
  useDownloadedFile,
  type LibraryFile,
  useNowPlayingGradient,
  useNowPlayingPalette,
  usePlayingYtSong,
  useTrackDetails,
} from "./hooks";
import { LyricsView } from "./LyricsView";
import { PlayerView } from "./PlayerView";
import { QueueHeader, UpNextList } from "./QueueView";
import { Scrubber } from "./Scrubber";
import { usePlayheadSource } from "./playhead";
import {
  closeNowPlaying,
  nowPlayingContentCommitted,
  onNowPlayingHidden,
  resizeNowPlaying,
  sheetOffset,
  useNowPlayingShown,
  useNowPlayingSettled,
} from "./sheet";
import { SleepTimerButton } from "./SleepTimer";
import { AddToPlaylistButton, DownloadButton } from "./SongButtons";
import { Transport } from "./Transport";
import {
  nowPlayingSongLookup,
  songActionFailed,
  usePlayingSongTarget,
  usePreparePlayingSong,
} from "./playingSong";

/** What fills the space above the controls. */
export type NowPlayingView = "player" | "queue" | "lyrics";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** An icon that switches Now Playing's view: teal while its view shows, graphite otherwise. */
function ViewToggle({
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
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  return (
    <Press
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      haptic="selection"
      depth={0.1}
      className="items-center justify-center"
      style={{ width: CELL * 6, height: CELL * 6 }}
    >
      <Icon size={24} color={on ? accent : secondary} strokeWidth={1.5} />
    </Press>
  );
}

const close = (): void => closeNowPlaying(undefined, "chevron");

type Item = NonNullable<PlaybackState["item"]>;

/**
 * The Queue view: what's playing and the toggles in the drag-to-dismiss
 * area, then Up Next. Once shown it stays mounted, hidden (`Activity`) while
 * the player or Lyrics shows and while Now Playing is closed: coming back
 * shows its rows as they were, re-rendering only what changed meanwhile.
 * Hidden, it follows nothing (its store subscriptions, gestures and frame
 * callbacks are effects, which `Activity` tears down) and holds only the
 * rows Legend List had drawn; each showing places Up Next again through the
 * list (`UpNextList`), so the rows show at once even if the queue changed out
 * of sight. Memoized, so the sheet's renders (the playing state) don't reach
 * it while it's hidden.
 */
const QueuePane = memo(function QueuePane({
  item,
  ground,
  onShowPlayer,
}: {
  item: Item;
  ground: DerivedValue<string[]>;
  onShowPlayer: () => void;
}) {
  // Where the pane sits on the sheet: the list's sticky bar draws the ground there.
  const [top, setTop] = useState(0);
  return (
    <View className="flex-1" onLayout={(event) => setTop(event.nativeEvent.layout.y)}>
      <DismissArea>
        <QueueHeader item={item} onShowPlayer={onShowPlayer} />
      </DismissArea>
      <UpNextList bottomInset={CELL * 2} ground={ground} paneTop={top} />
    </View>
  );
});

const PLAYER_AREA = { flex: 1, paddingTop: CELL } as const;

/**
 * The player view. It stays mounted, hidden (`Activity`) while the Queue or
 * Lyrics shows, so coming back to it draws the artwork straight away; hidden,
 * it follows nothing (links, the route, the star). While Now Playing is
 * closed it shows (out of sight) and follows the playing track, so an open's
 * first frame is right.
 */
const PlayerPane = memo(function PlayerPane({
  item,
  details,
  playing,
}: {
  item: Item;
  details: TrackDetails | null;
  playing: boolean;
}) {
  return (
    <DismissArea style={PLAYER_AREA}>
      <PlayerView item={item} details={details} playing={playing} />
    </DismissArea>
  );
});

/**
 * Wraps the screens under Now Playing: screen readers skip them while it is
 * up, and their shared Library queries pause (`CoveredByNowPlaying`).
 */
export function UnderNowPlaying({ children }: { children: ReactNode }) {
  const shown = useNowPlayingShown();
  const sharing = useSongShareShown();
  return (
    <View
      collapsable={false}
      style={{ flex: 1 }}
      importantForAccessibility={shown || sharing ? "no-hide-descendants" : "auto"}
    >
      <CoveredByNowPlaying.Provider value>{children}</CoveredByNowPlaying.Provider>
    </View>
  );
}

/**
 * Now Playing: a sheet over the app, tinted by the artwork. The player view
 * (artwork, title, artist and album), the Queue view or the Lyrics view sits
 * above the scrubber and transport. Drag it down, tap the chevron or press Back to
 * dismiss it.
 *
 * It stays mounted out of sight below the screen, following the playing track
 * (its colours, artwork and links) while closed, so opening it only starts the
 * spring and its first frame is already right.
 */
export function NowPlayingSheet() {
  useRenderCount("NowPlayingSheet");
  usePlayheadSource();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const shown = useNowPlayingShown();
  const songSharing = useSongShareShown();
  const lyricSharing = useLyricCardShown();
  const item = useSyncExternalStore(playbackState.subscribe, () => playbackState.get().item);
  const playing = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().playWhenReady,
  );
  const trackId = useCurrentTrackId();
  const details = useTrackDetails(trackId);
  const ytSong = usePlayingYtSong(trackId);
  const songTarget = usePlayingSongTarget(trackId, ytSong);
  const settled = useNowPlayingSettled();
  usePreparePlayingSong(songTarget, shown, settled);
  const palette = useNowPlayingPalette(trackId, details);
  const gradient = useNowPlayingGradient(palette);
  const ground = useBackgroundColors(gradient, shown);
  const [view, setView] = useState<NowPlayingView>("player");
  const showPlayer = useCallback(() => setView("player"), []);
  // The Queue, once shown, stays mounted while another view shows (`QueuePane`).
  const [queueWarm, setQueueWarm] = useState(false);
  useLayoutEffect(() => {
    if (shown) nowPlayingContentCommitted();
  }, [shown]);
  useLayoutEffect(() => {
    if (view !== "queue") return;
    const active = activeTiming();
    if (active?.kind === "queue") timingSurfaceCommitted(active.id);
  }, [view]);
  // A streamed song downloaded since it was queued: Lyrics reads its file, as for a Library song.
  const downloaded = useDownloadedFile(ytSong);
  const lyricsFile: LibraryFile | null =
    details === null ? (downloaded ?? null) : { id: details.id, path: details.path };
  // A non-D song's search waits until the Library is read: a song with a file reads it instead.
  const nonDTrackId = lyricsFile === null && downloaded !== undefined ? trackId : null;

  useEffect(() => resizeNowPlaying(height), [height]);

  // Every open starts on the player.
  useEffect(() => onNowPlayingHidden(() => setView("player")), []);

  // Back slides the sheet away instead of leaving the screen under it.
  useEffect(() => {
    if (!shown) return undefined;
    return addScreenBackHandler(() => {
      closeNowPlaying(undefined, "Back");
      return true;
    });
  }, [shown]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetOffset.get() }],
  }));

  const toggleQueue = () => {
    if (view !== "queue") beginTiming("queue", "Queue");
    setQueueWarm(true);
    setView((current) => (current === "queue" ? "player" : "queue"));
  };
  const toggleLyrics = () => {
    if (view !== "lyrics" && songTarget !== null)
      void nowPlayingSongLookup.acquire(songTarget).catch(songActionFailed);
    setView((current) => (current === "lyrics" ? "player" : "lyrics"));
  };

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, sheetStyle]}
      // Out of sight, it takes no touches and screen readers skip it.
      pointerEvents={shown ? "auto" : "none"}
      importantForAccessibility={shown && !songSharing ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!shown || songSharing}
    >
      <Background colors={ground} />
      <View
        className="flex-1"
        importantForAccessibility={lyricSharing ? "no-hide-descendants" : "auto"}
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + CELL * 2,
          paddingHorizontal: grid.margin,
        }}
      >
        <DismissArea
          style={{ marginHorizontal: -grid.margin, paddingHorizontal: grid.margin - 12 }}
        >
          <View className="flex-row items-center justify-between" style={{ height: CELL * 7 }}>
            <IconButton icon={IconChevronDown} label="Close Now Playing" onPress={close} />
            {item !== null && (
              <IconButton
                icon={IconShare3}
                label="Share Song"
                onPress={() =>
                  shareNowPlaying(
                    {
                      title: item.title ?? "Unknown title",
                      artist: item.artist ?? "Unknown Artist",
                      artworkUri: item.artworkUri ?? undefined,
                      palette,
                    },
                    trackId,
                    ytSong,
                  )
                }
              />
            )}
          </View>
        </DismissArea>

        {item === null ? (
          <DismissArea style={{ flex: 1 }}>
            <View className="flex-1 items-center justify-center">
              <Text className="font-sans text-subheadline text-secondary">Nothing is playing.</Text>
            </View>
          </DismissArea>
        ) : (
          <>
            {queueWarm && (
              <Activity mode={view === "queue" ? "visible" : "hidden"} name="Queue">
                <QueuePane item={item} ground={ground} onShowPlayer={showPlayer} />
              </Activity>
            )}
            {view === "lyrics" && (
              <LyricsView
                file={lyricsFile}
                nonDTrackId={nonDTrackId}
                item={item}
                palette={palette}
                onShowPlayer={showPlayer}
              />
            )}
            <Activity mode={view === "player" ? "visible" : "hidden"} name="Player">
              <PlayerPane item={item} details={details} playing={playing} />
            </Activity>
          </>
        )}

        <DismissArea style={{ paddingTop: CELL * 3, gap: CELL * 2 }}>
          <Scrubber />
          <Transport />
          {/* The song controls share one lookup after settlement or their own early tap. */}
          <View className="flex-row items-center justify-between">
            <ViewToggle
              icon={IconQuote}
              label="Lyrics"
              on={view === "lyrics"}
              onPress={toggleLyrics}
            />
            <SleepTimerButton />
            {item !== null && (
              <>
                <AddToPlaylistButton
                  trackId={trackId}
                  ytSong={ytSong}
                  title={item.title ?? "Unknown title"}
                />
                <DownloadButton trackId={trackId} ytSong={ytSong} />
              </>
            )}
            <ViewToggle
              icon={IconListNumbers}
              label="Queue"
              on={view === "queue"}
              onPress={toggleQueue}
            />
          </View>
        </DismissArea>
      </View>
      {/* The lyrics card's preview, over the whole sheet (Share in the Lyrics view). */}
      <LyricCardLayer />
    </Animated.View>
  );
}
