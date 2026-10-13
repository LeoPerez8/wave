import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerTrackNextFilled,
} from "@tabler/icons-react-native";
import { concentricRadius, resolveSkipSwipe, type SkipDirection } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useRef, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Artwork } from "@/catalog/Artwork";
import { CELL, grid } from "@/catalog/grid";
import { chrome, useTabBarTop } from "@/chrome/chrome";
import { IconButton } from "@/components/IconButton";
import { Glass } from "@/glass/Glass";
import { Press } from "@/motion/Press";
import {
  beginNowPlayingDrag,
  endNowPlayingDrag,
  sheetHeight,
  sheetOffset,
} from "@/nowPlaying/sheet";

import { skipToNext, skipToPrevious, togglePlayPause } from "./actions";
import { playbackState } from "./Player";

const RADIUS = chrome.miniPlayer / 2;

const ART = CELL * 5;
/** Gap between the artwork and the pill's leading edge. */
const ART_INSET = CELL * 1.5;
/** Artwork corners concentric with the pill's, worked out from its dimensions. */
const ART_RADIUS = concentricRadius({
  outerRadius: RADIUS,
  insetX: ART_INSET,
  insetY: (chrome.miniPlayer - ART) / 2,
  size: ART,
});

/** Horizontal travel before the drag takes over from a tap, in dp. */
const DRAG_SLOP = CELL * 1.5;

const EASE_OUT = Easing.out(Easing.exp);

const skip = (direction: SkipDirection): Promise<void> =>
  direction === "next" ? skipToNext() : skipToPrevious();

// Separate selectors, so position ticks don't re-render the mini player.
const usePlaybackField = <K extends "item" | "playWhenReady" | "error" | "notice">(key: K) =>
  useSyncExternalStore(playbackState.subscribe, () => playbackState.get()[key]);

type Props = {
  /** `nativeID` of the view behind the mini player, for the glass. */
  backdropId: string;
  /** Opens Now Playing. */
  onOpen: () => void;
};

/**
 * The floating glass mini player: artwork, title and artist, play/pause and
 * next. Swipe it left for the next track and right for the previous one; tap
 * it for Now Playing. It floats above the tab bar, or above the system inset
 * on screens without one.
 */
export function MiniPlayer({ backdropId, onOpen }: Props) {
  const item = usePlaybackField("item");
  const playing = usePlaybackField("playWhenReady");
  const error = usePlaybackField("error");
  const notice = usePlaybackField("notice");
  const bottom = useTabBarTop();
  const reduceMotion = useReducedMotion();

  const width = useSharedValue(1);
  const widthRef = useRef(1);
  const offset = useSharedValue(0);

  const finish = (translationX: number, velocityX: number, canceled: boolean) => {
    const direction = canceled
      ? null
      : resolveSkipSwipe({ translationX, velocityX, width: widthRef.current });
    if (direction === null) {
      offset.set(withSpring(0, { damping: 20, stiffness: 240 }));
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    skip(direction);
    if (reduceMotion) {
      offset.set(0);
      return;
    }
    // The old track leaves the way it was pushed and the new one slides in behind it.
    const out = direction === "next" ? -widthRef.current : widthRef.current;
    offset.set(
      withSequence(
        withTiming(out, { duration: 120, easing: EASE_OUT }),
        withTiming(-out / 3, { duration: 0 }),
        withTiming(0, { duration: 240, easing: EASE_OUT }),
      ),
    );
  };

  const pan = usePanGesture({
    activeOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    failOffsetY: [-DRAG_SLOP, DRAG_SLOP],
    onUpdate: (event) => {
      "worklet";
      offset.set(event.translationX);
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(finish, event.translationX, event.velocityX, event.canceled);
    },
  });

  // Swiping up pulls Now Playing out of the mini player, following the finger.
  const openPan = usePanGesture({
    activeOffsetY: [-DRAG_SLOP, 1_000_000],
    failOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    onActivate: () => {
      "worklet";
      scheduleOnRN(beginNowPlayingDrag);
    },
    onUpdate: (event) => {
      "worklet";
      const height = sheetHeight.get();
      sheetOffset.set(Math.min(height, Math.max(0, height + event.translationY)));
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(endNowPlayingDrag, event.translationY, event.velocityY);
    },
  });

  const contentStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(offset.get()) / width.get()) * 0.8,
    transform: [{ translateX: offset.get() }],
  }));

  if (item === null) return null;
  const title = item.title ?? "Unknown title";
  const subtitle =
    error === null ? (item.artist ?? "Unknown Artist") : (notice ?? "Couldn't play this file");

  return (
    <GestureDetector gesture={openPan}>
      <View
        pointerEvents="box-none"
        className="absolute"
        style={{ left: grid.margin, right: grid.margin, bottom, height: chrome.miniPlayer }}
        onLayout={(event) => {
          const measured = Math.max(1, event.nativeEvent.layout.width);
          widthRef.current = measured;
          width.set(measured);
        }}
      >
        <Glass backdropId={backdropId} cornerRadius={RADIUS} />
        <View className="flex-1 overflow-hidden" style={{ borderRadius: RADIUS }}>
          <GestureDetector gesture={pan}>
            <Animated.View className="flex-1 flex-row items-center" style={contentStyle}>
              <Press
                accessibilityRole="button"
                accessibilityLabel={`Now playing: ${title}, ${subtitle}`}
                accessibilityHint="Opens Now Playing"
                accessibilityActions={[
                  { name: "next", label: "Next track" },
                  { name: "previous", label: "Previous track" },
                ]}
                onAccessibilityAction={(event) =>
                  skip(event.nativeEvent.actionName === "next" ? "next" : "previous")
                }
                onPress={onOpen}
                haptic="selection"
                depth={0.015}
                className="flex-1 flex-row items-center self-stretch"
                style={{ gap: CELL * 1.5, paddingLeft: ART_INSET }}
              >
                <Artwork uri={item.artworkUri ?? undefined} size={ART} radius={ART_RADIUS} />
                <View className="flex-1">
                  <Text
                    numberOfLines={1}
                    className="font-sans text-body font-medium text-foreground"
                  >
                    {title}
                  </Text>
                  <Text numberOfLines={1} className="font-sans text-body text-secondary">
                    {subtitle}
                  </Text>
                </View>
              </Press>
              <View className="flex-row" style={{ paddingRight: CELL / 2 }}>
                <IconButton
                  icon={playing ? IconPlayerPauseFilled : IconPlayerPlayFilled}
                  label={playing ? `Pause ${title}` : `Play ${title}`}
                  onPress={togglePlayPause}
                />
                <IconButton
                  icon={IconPlayerTrackNextFilled}
                  label="Next track"
                  onPress={skipToNext}
                />
              </View>
            </Animated.View>
          </GestureDetector>
        </View>
      </View>
    </GestureDetector>
  );
}
