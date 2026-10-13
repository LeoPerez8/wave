import { IconChevronDown, IconListNumbers, IconQuote } from "@tabler/icons-react-native";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { Press } from "@/motion/Press";
import { addScreenBackHandler } from "@/overlay/back";
import { useCurrentTrackId } from "@/playback/hooks";
import { playbackState } from "@/playback/Player";
import { useThemeColor } from "@/theme/useThemeColor";

import { Background } from "./Background";
import { DismissArea } from "./DismissArea";
import { useNowPlayingGradient, useTrackDetails } from "./hooks";
import { LyricsView } from "./LyricsView";
import { PlayerView } from "./PlayerView";
import { QueueHeader, UpNextList } from "./QueueView";
import { Scrubber } from "./Scrubber";
import {
  closeNowPlaying,
  onNowPlayingHidden,
  resizeNowPlaying,
  sheetOffset,
  useNowPlayingShown,
} from "./sheet";
import { SleepTimerButton } from "./SleepTimer";
import { TrackHeader } from "./TrackHeader";
import { Transport } from "./Transport";

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

const close = (): void => closeNowPlaying();

/** Wraps the screens under Now Playing: screen readers skip them while it is up. */
export function UnderNowPlaying({ children }: { children: ReactNode }) {
  const shown = useNowPlayingShown();
  return (
    <View
      collapsable={false}
      style={{ flex: 1 }}
      importantForAccessibility={shown ? "no-hide-descendants" : "auto"}
    >
      {children}
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
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const shown = useNowPlayingShown();
  const item = useSyncExternalStore(playbackState.subscribe, () => playbackState.get().item);
  const playing = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().playWhenReady,
  );
  const details = useTrackDetails(useCurrentTrackId());
  const gradient = useNowPlayingGradient(details);
  const [view, setView] = useState<NowPlayingView>("player");

  useEffect(() => resizeNowPlaying(height), [height]);

  // Every open starts on the player.
  useEffect(() => onNowPlayingHidden(() => setView("player")), []);

  // Back slides the sheet away instead of leaving the screen under it.
  useEffect(() => {
    if (!shown) return undefined;
    return addScreenBackHandler(() => {
      closeNowPlaying();
      return true;
    });
  }, [shown]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetOffset.get() }],
  }));

  const toggleQueue = () => setView((current) => (current === "queue" ? "player" : "queue"));
  const toggleLyrics = () => setView((current) => (current === "lyrics" ? "player" : "lyrics"));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, sheetStyle]}
      // Out of sight, it takes no touches and screen readers skip it.
      pointerEvents={shown ? "auto" : "none"}
      importantForAccessibility={shown ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!shown}
    >
      <Background gradient={gradient} animate={shown} />
      <View
        className="flex-1"
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + CELL * 2,
          paddingHorizontal: grid.margin,
        }}
      >
        <DismissArea
          style={{ marginHorizontal: -grid.margin, paddingHorizontal: grid.margin - 12 }}
        >
          <View className="flex-row items-center" style={{ height: CELL * 7 }}>
            <IconButton icon={IconChevronDown} label="Close Now Playing" onPress={close} />
          </View>
        </DismissArea>

        {item === null ? (
          <DismissArea style={{ flex: 1 }}>
            <View className="flex-1 items-center justify-center">
              <Text className="font-sans text-subheadline text-secondary">Nothing is playing.</Text>
            </View>
          </DismissArea>
        ) : view === "queue" ? (
          <View className="flex-1">
            <DismissArea>
              <QueueHeader item={item} />
            </DismissArea>
            <UpNextList bottomInset={CELL * 2} />
          </View>
        ) : view === "lyrics" ? (
          <View className="flex-1">
            <DismissArea>
              <TrackHeader item={item} />
            </DismissArea>
            <LyricsView path={details?.path ?? null} />
          </View>
        ) : (
          <DismissArea style={{ flex: 1, paddingTop: CELL }}>
            <PlayerView item={item} details={details} playing={playing} />
          </DismissArea>
        )}

        <DismissArea style={{ paddingTop: CELL * 3, gap: CELL * 2 }}>
          <Scrubber />
          <Transport />
          <View className="flex-row items-center">
            <ViewToggle
              icon={IconQuote}
              label="Lyrics"
              on={view === "lyrics"}
              onPress={toggleLyrics}
            />
            <SleepTimerButton />
            <View className="flex-1" />
            <ViewToggle
              icon={IconListNumbers}
              label="Queue"
              on={view === "queue"}
              onPress={toggleQueue}
            />
          </View>
        </DismissArea>
      </View>
    </Animated.View>
  );
}
