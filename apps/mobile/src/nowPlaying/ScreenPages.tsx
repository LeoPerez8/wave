import { useLocalisation } from "@/localisation/localisation";
import {
  NOW_PLAYING_OPENS_ON,
  settleScreenSwipe,
  stepNowPlayingScreens,
  type NowPlayingScreen,
  type NowPlayingScreensEvent,
} from "@wave/core";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { handleSwipeSlop } from "@/motion/handleHold";
import { useListScrollable } from "@/motion/heldTouch";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * Now Playing's screens side by side: the player, and the Queue one swipe to
 * its right. Core decides which screen shows after each event
 * (`stepNowPlayingScreens`) and where a released swipe settles
 * (`settleScreenSwipe`); this moves the pages there.
 */

/** Sideways travel before a swipe takes over from a tap, in dp. */
const SWIPE_SLOP = CELL * 1.5;

/** The page's right end that Up Next's drag handles take: the side margin and the handle's cell. */
const HANDLES = grid.margin + grid.upNextCell;

/** The sheet's own spring: quick, with a little give and no wobble. */
const SPRING = { damping: 30, stiffness: 300, mass: 1 } as const;

export type ScreenPages = {
  /** The screen that shows, or the one a turn is heading to. */
  readonly screen: NowPlayingScreen;
  /** A swipe or its settle is under way: both pages are in sight. */
  readonly turning: boolean;
  /** The Queue was shown once, so it stays mounted. */
  readonly queueMounted: boolean;
  /** Where the pages are: 0 on the player, 1 on the Queue. */
  readonly position: SharedValue<number>;
  /** Takes the screens through [event]; true when Now Playing itself should close. */
  readonly send: (event: NowPlayingScreensEvent) => boolean;
  /** A swipe from the page of [from] started, and ended (dp, dp/s; negative is left). */
  readonly swipeBegan: () => void;
  readonly swipeEnded: (from: NowPlayingScreen, translationX: number, velocityX: number) => void;
};

/**
 * Now Playing's screens and the pages' position. With reduce motion (Remove
 * animations) on, a page shows or leaves at once, with no slide.
 */
export const useScreenPages = (): ScreenPages => {
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  const [screens, setScreens] = useState(NOW_PLAYING_OPENS_ON);
  const [turning, setTurning] = useState(false);
  const [queueMounted, setQueueMounted] = useState(false);
  const position = useSharedValue(0);
  // What the handlers step from: the screens as of the last event, ahead of the render.
  const latest = useRef(screens);

  const turnTo = useCallback(
    (screen: NowPlayingScreen, velocity: number, slide: boolean) => {
      const to = screen === "queue" ? 1 : 0;
      if (!slide) {
        position.set(to);
        setTurning(false);
        return;
      }
      setTurning(true);
      position.set(
        withSpring(to, { ...SPRING, velocity }, (finished) => {
          if (finished === true) scheduleOnRN(setTurning, false);
        }),
      );
    },
    [position],
  );

  const send = useCallback(
    (event: NowPlayingScreensEvent, velocity = 0): boolean => {
      const before = latest.current;
      const step = stepNowPlayingScreens(before, event);
      latest.current = step.screens;
      setScreens(step.screens);
      if (step.screens.screen === "queue") setQueueMounted(true);
      // A released swipe settles from wherever the finger left the pages.
      if (event.type === "swipe") turnTo(step.screens.screen, velocity, !still);
      // Out of sight, there is nothing to slide, and a swipe left half way ends there.
      else if (event.type === "closed") turnTo(step.screens.screen, 0, false);
      else if (step.screens.screen !== before.screen) turnTo(step.screens.screen, 0, !still);
      return step.close;
    },
    [turnTo, still],
  );

  const swipeBegan = useCallback(() => {
    setQueueMounted(true);
    setTurning(true);
  }, []);

  const swipeEnded = useCallback(
    (from: NowPlayingScreen, translationX: number, velocityX: number) => {
      const to = settleScreenSwipe({ from, translationX, velocityX, width });
      // The pages move against the finger: a drag left raises the position.
      send({ type: "swipe", to }, width > 0 ? -velocityX / width : 0);
    },
    [send, width],
  );

  return useMemo(
    () => ({
      screen: screens.screen,
      turning,
      queueMounted,
      position,
      send,
      swipeBegan,
      swipeEnded,
    }),
    [screens.screen, turning, queueMounted, position, send, swipeBegan, swipeEnded],
  );
};

const PAGE = { marginHorizontal: -grid.margin, paddingHorizontal: grid.margin } as const;
const PLAYER_PAGE = { ...PAGE, flex: 1 } as const;
const QUEUE_PAGE = {
  ...PAGE,
  position: "absolute",
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
} as const;

/**
 * One of Now Playing's pages, as wide as the screen. A sideways drag on it
 * toward the other page turns to it, following the finger: left on the
 * player, right on the Queue. The scrubber claims its touch first and keeps
 * it; the Queue's swipe can't begin on Up Next's handles; and a drag up or down
 * belongs to the page's lists and the sheet. Away from the screen it takes no
 * touches and screen readers skip it.
 */
export function ScreenPage({
  screen,
  pages,
  swipes = true,
  children,
}: {
  screen: NowPlayingScreen;
  pages: ScreenPages;
  /** Whether a drag here turns the page (not with nothing playing). */
  swipes?: boolean;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  // A long-pressed finger slides onto its menu's entries; it doesn't turn the page.
  const draggable = useListScrollable();
  const { position, swipeBegan, swipeEnded } = pages;
  const start = useSharedValue(0);
  const player = screen === "player";
  const pan = usePanGesture({
    enabled: swipes && draggable,
    // A handle's pan fails on an early move, so a swipe from one would turn the page.
    hitSlop: handleSwipeSlop(player ? 0 : HANDLES),
    // Only a drag toward the other page claims the touch.
    activeOffsetX: player ? [-SWIPE_SLOP, 1_000_000] : [-1_000_000, SWIPE_SLOP],
    failOffsetY: [-SWIPE_SLOP * 2, SWIPE_SLOP * 2],
    onActivate: () => {
      "worklet";
      start.set(position.get());
      scheduleOnRN(swipeBegan);
    },
    onUpdate: (event) => {
      "worklet";
      if (still || width <= 0) return;
      position.set(Math.min(1, Math.max(0, start.get() - event.translationX / width)));
    },
    onDeactivate: (event) => {
      "worklet";
      // A touch taken away settles back where it started.
      const released = !event.canceled;
      scheduleOnRN(
        swipeEnded,
        screen,
        released ? event.translationX : 0,
        released ? event.velocityX : 0,
      );
    },
  });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: ((player ? 0 : 1) - position.get()) * width }],
  }));
  const here = pages.screen === screen || pages.turning;
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[player ? PLAYER_PAGE : QUEUE_PAGE, style]}
        pointerEvents={here ? "auto" : "none"}
        importantForAccessibility={here ? "auto" : "no-hide-descendants"}
        accessibilityElementsHidden={!here}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

/** The mark's bar, and the touch target around it. */
const MARK = { width: CELL / 2, height: CELL * 7 } as const;
const MARK_TARGET = { width: grid.margin + CELL, height: CELL * 9 } as const;

/**
 * A small bar on the player's right edge: the Queue is one swipe away. Screen
 * readers hear it as a button named Queue, which opens it.
 */
export function QueueEdgeMark({ onPress }: { onPress: () => void }) {
  const { strings } = useLocalisation();
  const tertiary = useThemeColor("tertiary");
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={strings.playbackText.queue}
      onPress={onPress}
      haptic="selection"
      depth={0}
      className="absolute right-0 items-end justify-center"
      style={[MARK_TARGET, { top: "44%" }]}
    >
      <View
        style={[
          MARK,
          {
            backgroundColor: tertiary,
            borderTopLeftRadius: MARK.width / 2,
            borderBottomLeftRadius: MARK.width / 2,
          },
        ]}
      />
    </Press>
  );
}
