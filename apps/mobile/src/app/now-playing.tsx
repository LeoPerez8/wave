import { IconChevronDown, IconListNumbers, IconQuote } from "@tabler/icons-react-native";
import type { ComponentType } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { Press } from "@/motion/Press";
import { Background } from "@/nowPlaying/Background";
import { DismissArea } from "@/nowPlaying/DismissArea";
import { useNowPlayingGradient, useTrackDetails } from "@/nowPlaying/hooks";
import { LyricsView } from "@/nowPlaying/LyricsView";
import { PlayerView } from "@/nowPlaying/PlayerView";
import { QueueHeader, UpNextList } from "@/nowPlaying/QueueView";
import { Scrubber } from "@/nowPlaying/Scrubber";
import { closeNowPlaying, nowPlayingMounted, sheetHeight, sheetOffset } from "@/nowPlaying/sheet";
import { SleepTimerButton } from "@/nowPlaying/SleepTimer";
import { TrackHeader } from "@/nowPlaying/TrackHeader";
import { Transport } from "@/nowPlaying/Transport";
import { addScreenBackHandler } from "@/overlay/back";
import { useCurrentTrackId } from "@/playback/hooks";
import { playbackState } from "@/playback/Player";
import { useThemeColor } from "@/theme/useThemeColor";

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

/**
 * Now Playing: a sheet over the tabs, tinted by the artwork. The player view
 * (artwork, title, artist and album), the Queue view or the Lyrics view sits
 * above the scrubber and transport. Drag it down, tap the chevron or press Back to
 * dismiss it.
 */
export default function NowPlayingScreen() {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const item = useSyncExternalStore(playbackState.subscribe, () => playbackState.get().item);
  const playing = useSyncExternalStore(
    playbackState.subscribe,
    () => playbackState.get().playWhenReady,
  );
  const details = useTrackDetails(useCurrentTrackId());
  const gradient = useNowPlayingGradient(details);
  const [view, setView] = useState<NowPlayingView>("player");

  useEffect(() => {
    sheetHeight.set(height);
  }, [height]);

  useEffect(nowPlayingMounted, []);

  // Back slides the sheet away instead of cutting to the tabs.
  useEffect(
    () =>
      addScreenBackHandler(() => {
        closeNowPlaying();
        return true;
      }),
    [],
  );

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetOffset.get() }],
  }));

  const toggleQueue = () => setView((current) => (current === "queue" ? "player" : "queue"));
  const toggleLyrics = () => setView((current) => (current === "lyrics" ? "player" : "lyrics"));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, sheetStyle]}>
      <Background gradient={gradient} />
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
