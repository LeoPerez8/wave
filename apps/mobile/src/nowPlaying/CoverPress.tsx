import { useLocalisation } from "@/localisation/localisation";
import { IconStarFilled } from "@tabler/icons-react-native";
import { coverDoubleTap, createCoverTaps, type CoverDoubleTap, type CoverTaps } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { togglePlayPause } from "@/playback/actions";
import { useThemeColor } from "@/theme/useThemeColor";

/** How long the star stays over the cover after a double-tap, in ms. */
const STAR_MS = 700;

/** The star's pop in (the star beside the title pops with it too) and fade out. */
export const STAR_POP = { damping: 14, stiffness: 260, mass: 0.6 } as const;
const FADE_IN_MS = 90;
const FADE_OUT_MS = 220;

/** The star's size against the cover's side. */
const STAR_SCALE = 0.28;

type Props = {
  /** The cover's side, in dp. */
  size: number;
  playing: boolean;
  /** Whether the song playing is in Favorites, and whether it can be starred yet. */
  starred: boolean;
  canStar: boolean;
  /** Adds the song playing to Favorites, as its menu's Favorite does. */
  addFavorite: () => void;
  children: ReactNode;
};

/**
 * Now Playing's cover as a control: a tap plays or pauses (the cover's shrink
 * is the feedback), a double-tap adds the song to Favorites with a star over
 * the cover and a light haptic tick, and on a favorite only shows the star
 * (Core's `createCoverTaps` and `coverDoubleTap`). A drag down still closes
 * Now Playing: the sheet's drag takes the touch from the press. Screen
 * readers get play/pause as the activate action and Favorite as a custom one.
 */
export function CoverPress({ size, playing, starred, canStar, addFavorite, children }: Props) {
  const { strings } = useLocalisation();
  const highlight = useThemeColor("highlight");
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The double-tap acts on the song as it is when the taps land.
  const latest = useRef({ starred, canStar, addFavorite, reduceMotion });
  useEffect(() => {
    latest.current = { starred, canStar, addFavorite, reduceMotion };
  });

  const showStar = (): void => {
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    // Under reduce motion the star just appears and disappears.
    const still = latest.current.reduceMotion;
    if (still) {
      opacity.set(1);
      scale.set(1);
    } else {
      opacity.set(withTiming(1, { duration: FADE_IN_MS, reduceMotion: ReduceMotion.Never }));
      scale.set(0.6);
      scale.set(withSpring(1, { ...STAR_POP, reduceMotion: ReduceMotion.Never }));
    }
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      opacity.set(
        still ? 0 : withTiming(0, { duration: FADE_OUT_MS, reduceMotion: ReduceMotion.Never }),
      );
    }, STAR_MS);
  };

  /** Runs a double-tap; says what it did. */
  const doubleTap = (): CoverDoubleTap => {
    const { starred: on, canStar: can, addFavorite: add } = latest.current;
    const outcome = coverDoubleTap({ starred: on, canStar: can });
    if (outcome === "none") return outcome;
    if (outcome === "favorite") add();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showStar();
    return outcome;
  };
  const latestDoubleTap = useRef(doubleTap);
  useEffect(() => {
    latestDoubleTap.current = doubleTap;
  });

  // Told apart while the cover shows; a tap still waiting, or a star still showing,
  // ends with it (hidden behind the Queue or Lyrics, or gone).
  const taps = useRef<CoverTaps | null>(null);
  useEffect(() => {
    const cover = createCoverTaps({
      schedule: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
      onTap: () => void togglePlayPause(),
      onDoubleTap: () => void latestDoubleTap.current(),
    });
    taps.current = cover;
    return () => {
      cover.cancel();
      taps.current = null;
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      hideTimer.current = null;
      opacity.set(0);
    };
  }, [opacity]);

  const starStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ scale: scale.get() }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={strings.playbackText.cover}
      accessibilityHint={
        playing ? strings.playbackText.pausesTheSong : strings.playbackText.playsTheSong
      }
      accessibilityActions={[
        {
          name: "activate",
          label: playing ? strings.playbackText.pause : strings.playbackText.play,
        },
        { name: "favorite", label: strings.playbackText.favorite },
      ]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === "activate") void togglePlayPause();
        if (nativeEvent.actionName === "favorite") {
          const outcome = doubleTap();
          if (outcome !== "none")
            AccessibilityInfo.announceForAccessibility(
              outcome === "favorite"
                ? strings.playbackText.addedToFavorites
                : strings.playbackText.inFavorites,
            );
        }
      }}
      onPress={() => taps.current?.tap()}
      style={{ width: size, height: size }}
    >
      {children}
      <View
        pointerEvents="none"
        className="absolute inset-0 items-center justify-center"
        importantForAccessibility="no-hide-descendants"
      >
        <Animated.View style={starStyle}>
          <IconStarFilled size={Math.round(size * STAR_SCALE)} color={highlight} />
        </Animated.View>
      </View>
    </Pressable>
  );
}
