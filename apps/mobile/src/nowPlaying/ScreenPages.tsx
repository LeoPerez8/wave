import { useLocalisation } from "@/localisation/localisation";
import {
  NOW_PLAYING_OPENS_ON,
  settleScreenSwipe,
  settleSheet,
  stepNowPlayingScreens,
  type NowPlayingPage,
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
import { beginTiming } from "@/lib/timing";
import { handleSwipeSlop } from "@/motion/handleHold";
import { useListScrollable } from "@/motion/heldTouch";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { isNowPlayingShown } from "./sheet";

/**
 * Now Playing's screens: the player and the Queue side by side, one swipe
 * apart, and Related, a panel that rises over them (`RelatedPanel`). Core
 * decides which screen shows after each event and whether the player's slots
 * are being edited (`stepNowPlayingScreens`), and
 * where a released swipe settles (`settleScreenSwipe`); this moves the pages
 * and the panel there.
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
  /** Edit mode: the player's slots are being edited, and no screen turns or rises. */
  readonly editing: boolean;
  /** The page in the pages' place: the one Related covers while it shows. */
  readonly page: NowPlayingPage;
  /** A swipe or its settle is under way: both pages are in sight. */
  readonly turning: boolean;
  /** The Queue was shown once, so it stays mounted. */
  readonly queueMounted: boolean;
  /** Where the pages are: 0 on the player, 1 on the Queue. */
  readonly position: SharedValue<number>;
  /** Where Related's panel is: 0 below the screen, 1 risen over the pages. */
  readonly related: SharedValue<number>;
  /** The panel is rising, leaving or under a finger: the page under it is in sight. */
  readonly relatedMoving: boolean;
  /**
   * The screen is Related, as of the last event: a finger on the panel moves
   * it only while this holds, so a screen that leaves mid-drag takes the panel.
   */
  readonly relatedHere: SharedValue<boolean>;
  /** Takes the screens through [event]; true when Now Playing itself should close. */
  readonly send: (event: NowPlayingScreensEvent) => boolean;
  /** A swipe from the page of [from] started, and ended (dp, dp/s; negative is left). */
  readonly swipeBegan: () => void;
  readonly swipeEnded: (from: NowPlayingPage, translationX: number, velocityX: number) => void;
  /** A drag down on Related's header started, and ended (dp down, dp/s). */
  readonly relatedDragBegan: () => void;
  readonly relatedDragEnded: (translationY: number, velocityY: number) => void;
  readonly relatedOpenDragBegan: () => void;
  readonly relatedOpenDragEnded: (translationY: number, velocityY: number) => void;
};

/**
 * Now Playing's screens, the pages' position and the Related panel's. With
 * reduce motion (Remove animations) on, a page or the panel shows or leaves at
 * once, with no slide.
 */
export const useScreenPages = (): ScreenPages => {
  const { width, height } = useWindowDimensions();
  const still = useReducedMotion();
  const [screens, setScreens] = useState(NOW_PLAYING_OPENS_ON);
  const [turning, setTurning] = useState(false);
  const [queueMounted, setQueueMounted] = useState(false);
  const [page, setPage] = useState<NowPlayingPage>("player");
  const [relatedMoving, setRelatedMoving] = useState(false);
  const position = useSharedValue(0);
  const related = useSharedValue(0);
  const relatedHere = useSharedValue(false);
  // What the handlers step from: the screens as of the last event, ahead of the render.
  const latest = useRef(screens);

  const turnTo = useCallback(
    (screen: NowPlayingPage, velocity: number, slide: boolean) => {
      setPage(screen);
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

  // The panel came to rest. Risen, it covers the pages, so they turn to the
  // player out of sight: Related always returns there.
  const relatedRested = useCallback(
    (risen: boolean) => {
      setRelatedMoving(false);
      if (risen) turnTo("player", 0, false);
    },
    [turnTo],
  );

  const movePanel = useCallback(
    (risen: boolean, velocity: number, slide: boolean) => {
      const to = risen ? 1 : 0;
      if (!slide) {
        related.set(to);
        relatedRested(risen);
        return;
      }
      setRelatedMoving(true);
      related.set(
        withSpring(to, { ...SPRING, velocity }, (finished) => {
          if (finished === true) scheduleOnRN(relatedRested, risen);
        }),
      );
    },
    [related, relatedRested],
  );

  const send = useCallback(
    (event: NowPlayingScreensEvent, velocity = 0): boolean => {
      const before = latest.current;
      const step = stepNowPlayingScreens(before, event);
      latest.current = step.screens;
      setScreens(step.screens);
      const { screen } = step.screens;
      // Ahead of the panel's own move, so a finger still on it stops moving it.
      relatedHere.set(screen === "related");
      if (screen === "queue") setQueueMounted(true);
      if (screen === "related") {
        // Asked for with Now Playing closed, the sheet rises already on it.
        if (before.screen !== "related") movePanel(true, 0, !still && isNowPlayingShown());
      } else if (before.screen === "related") {
        // The pages are covered until the panel moves, so they turn at once.
        turnTo(screen, 0, false);
        movePanel(false, velocity, !still && event.type !== "closed");
      }
      // A released swipe settles from wherever the finger left the pages.
      else if (event.type === "swipe") turnTo(screen, velocity, !still);
      // Out of sight, there is nothing to slide, and a swipe left half way ends there.
      else if (event.type === "closed") turnTo(screen, 0, false);
      else if (screen !== before.screen) turnTo(screen, 0, !still);
      return step.close;
    },
    [turnTo, movePanel, still, relatedHere],
  );

  const swipeBegan = useCallback(() => {
    setQueueMounted(true);
    setTurning(true);
  }, []);

  const swipeEnded = useCallback(
    (from: NowPlayingPage, translationX: number, velocityX: number) => {
      const to = settleScreenSwipe({ from, translationX, velocityX, width });
      // Most ways into the Queue are a swipe: its open is timed like the button's.
      if (to === "queue" && latest.current.screen !== "queue") beginTiming("queue", "Queue");
      // The pages move against the finger: a drag left raises the position.
      send({ type: "swipe", to }, width > 0 ? -velocityX / width : 0);
    },
    [send, width],
  );

  const relatedDragBegan = useCallback(() => {
    if (latest.current.screen === "related") setRelatedMoving(true);
  }, []);

  const relatedDragEnded = useCallback(
    (translationY: number, velocityY: number) => {
      // The screen left Related under the finger (Back, the queue ending, YT Music
      // off): the panel goes the rest of the way and rests, wherever the drag left it.
      if (latest.current.screen !== "related") {
        movePanel(false, 0, !still && isNowPlayingShown());
        return;
      }
      // The panel leaves by the travel and speed that dismiss the sheet.
      const drag = { from: "open", offset: translationY, velocity: velocityY, height } as const;
      // The panel's position falls as the finger goes down.
      if (settleSheet(drag) === "closed")
        send({ type: "dragDown" }, height > 0 ? -velocityY / height : 0);
      else movePanel(true, 0, !still);
    },
    [send, movePanel, height, still],
  );

  const relatedOpenDragBegan = useCallback(() => setRelatedMoving(true), []);
  const relatedOpenDragEnded = useCallback(
    (translationY: number, velocityY: number) => {
      const settled = settleSheet({
        from: "closed",
        offset: height - Math.max(0, -translationY),
        velocity: -velocityY,
        height,
      });
      if (settled === "open") send({ type: "show", screen: "related" });
      else movePanel(false, 0, !still);
    },
    [height, send, movePanel, still],
  );

  return useMemo(
    () => ({
      screen: screens.screen,
      editing: screens.editing,
      page,
      turning,
      queueMounted,
      position,
      related,
      relatedMoving,
      relatedHere,
      send,
      swipeBegan,
      swipeEnded,
      relatedDragBegan,
      relatedDragEnded,
      relatedOpenDragBegan,
      relatedOpenDragEnded,
    }),
    [
      screens.screen,
      screens.editing,
      page,
      turning,
      queueMounted,
      position,
      related,
      relatedMoving,
      relatedHere,
      send,
      swipeBegan,
      swipeEnded,
      relatedDragBegan,
      relatedDragEnded,
      relatedOpenDragBegan,
      relatedOpenDragEnded,
    ],
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
 * belongs to the page's lists and the sheet. Away from the screen, or under
 * Related, it takes no touches and screen readers skip it.
 */
export function ScreenPage({
  screen,
  pages,
  swipes = true,
  relatedSwipe = false,
  children,
}: {
  screen: NowPlayingPage;
  pages: ScreenPages;
  /** Whether a drag here turns the page (not with nothing playing). */
  swipes?: boolean;
  relatedSwipe?: boolean;
  children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const still = useReducedMotion();
  // A long-pressed finger slides onto its menu's entries; it doesn't turn the page.
  const draggable = useListScrollable();
  const { position, swipeBegan, swipeEnded, related, relatedOpenDragBegan, relatedOpenDragEnded } =
    pages;
  const start = useSharedValue(0);
  const dragKind = useSharedValue(0);
  const player = screen === "player";
  const pan = usePanGesture({
    enabled: swipes && draggable,
    // A handle's pan fails on an early move, so a swipe from one would turn the page.
    hitSlop: handleSwipeSlop(player ? 0 : HANDLES),
    // Only a drag toward the other page claims the touch.
    activeOffsetX: player ? [-SWIPE_SLOP, 1_000_000] : [-1_000_000, SWIPE_SLOP],
    activeOffsetY: relatedSwipe ? [-SWIPE_SLOP, 1_000_000] : undefined,
    failOffsetY: relatedSwipe ? undefined : [-SWIPE_SLOP * 2, SWIPE_SLOP * 2],
    onActivate: (event) => {
      "worklet";
      dragKind.set(
        relatedSwipe &&
          Math.abs(event.translationY) > Math.abs(event.translationX) &&
          event.translationY < 0
          ? 1
          : 0,
      );
      start.set(position.get());
      if (dragKind.get() === 1) scheduleOnRN(relatedOpenDragBegan);
      else scheduleOnRN(swipeBegan);
    },
    onUpdate: (event) => {
      "worklet";
      if (dragKind.get() === 1) {
        if (!still && height > 0)
          related.set(Math.min(1, Math.max(0, -event.translationY / height)));
      } else if (!still && width > 0)
        position.set(Math.min(1, Math.max(0, start.get() - event.translationX / width)));
    },
    onDeactivate: (event) => {
      "worklet";
      // A touch taken away settles back where it started.
      const released = !event.canceled;
      if (dragKind.get() === 1) {
        scheduleOnRN(
          relatedOpenDragEnded,
          released ? event.translationY : 0,
          released ? event.velocityY : 0,
        );
      } else {
        scheduleOnRN(
          swipeEnded,
          screen,
          released ? event.translationX : 0,
          released ? event.velocityX : 0,
        );
      }
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
