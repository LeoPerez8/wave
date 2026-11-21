import { useLocalisation } from "@/localisation/localisation";
import {
  NOW_PLAYING_OPENS_ON,
  settleRelatedRise,
  settleScreenSwipe,
  settleSheet,
  stepNowPlayingScreens,
  type NowPlayingPage,
  type NowPlayingScreen,
  type NowPlayingScreensEvent,
} from "@wave/core";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
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
  /** A drag up on the player, which raises Related, started, and ended (dp, dp/s; negative is up). */
  readonly relatedRiseBegan: () => void;
  readonly relatedRiseEnded: (translationY: number, velocityY: number) => void;
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
        // Asked for with Now Playing closed, the sheet rises already on it. A released
        // rise carries its speed, so a flick up keeps moving into the open panel.
        if (before.screen !== "related") movePanel(true, velocity, !still && isNowPlayingShown());
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

  // Related's panel is drawn and under the finger from the drag's start.
  const relatedRiseBegan = useCallback(() => setRelatedMoving(true), []);

  const relatedRiseEnded = useCallback(
    (translationY: number, velocityY: number) => {
      // The panel rises by the travel and speed that open the sheet (Core's
      // `settleRelatedRise`), unless the player left under the finger (Now Playing closed).
      const rise =
        latest.current.screen === "player" && isNowPlayingShown()
          ? settleRelatedRise({ translationY, velocityY, height })
          : "closed";
      // The panel's position rises as the finger goes up, either way it settles.
      const velocity = height > 0 ? -velocityY / height : 0;
      if (rise === "open") send({ type: "show", screen: "related" }, velocity);
      else movePanel(false, velocity, !still && isNowPlayingShown());
    },
    [send, movePanel, height, still],
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
      relatedRiseBegan,
      relatedRiseEnded,
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
      relatedRiseBegan,
      relatedRiseEnded,
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
 * belongs to the page's lists and the sheet, or on the player a drag up to
 * Related ([rise], which its `RelatedRiseArea`s take). Away from the screen, or
 * under Related, it takes no touches and screen readers skip it.
 */
export function ScreenPage({
  screen,
  pages,
  swipes = true,
  rise,
  children,
}: {
  screen: NowPlayingPage;
  pages: ScreenPages;
  /** Whether a drag here turns the page (not with nothing playing). */
  swipes?: boolean;
  /** The player's drag up, which its `RelatedRiseArea`s take. */
  rise?: RelatedRise;
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
        {rise === undefined ? (
          children
        ) : (
          <RelatedRiseContext.Provider value={rise}>{children}</RelatedRiseContext.Provider>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

/** What the player's drag up needs: whether it is on, and the panel it raises. */
export type RelatedRise = Pick<ScreenPages, "related" | "relatedRiseBegan" | "relatedRiseEnded"> & {
  /** On the player, out of edit mode, with YouTube Music on (Core's `nowPlayingRelatedSwipeEnabled`). */
  readonly enabled: boolean;
};

/** The player's drag up, for its parts (`RelatedRiseArea`); the player's `ScreenPage` gives it. */
const RelatedRiseContext = createContext<RelatedRise | null>(null);

/**
 * Part of the player that raises Related on a drag up: the cover, the title,
 * the controls, Lyrics' header, the Queue's mark. Related's panel follows the
 * finger, and on release Core decides whether it opens (`relatedRiseEnded`).
 * The Lyrics body is left out, so a drag up there scrolls the lyrics. A
 * control that claims its touch first (the scrubber) keeps it; a button's tap
 * still presses it. Each direction has one owner: up raises Related, down
 * drags the sheet (`DismissArea`) and sideways turns the page (`ScreenPage`).
 * Outside the player's page it is a plain view.
 */
export function RelatedRiseArea({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const rise = useContext(RelatedRiseContext);
  if (rise === null) return <View style={style}>{children}</View>;
  return (
    <RelatedRisePan rise={rise} style={style}>
      {children}
    </RelatedRisePan>
  );
}

function RelatedRisePan({
  rise,
  children,
  style,
}: {
  rise: RelatedRise;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { height } = useWindowDimensions();
  const still = useReducedMotion();
  // A long-pressed finger slides onto its menu's entries; it doesn't raise Related.
  const draggable = useListScrollable();
  const { enabled, related, relatedRiseBegan, relatedRiseEnded } = rise;
  const pan = usePanGesture({
    enabled: enabled && draggable,
    // Only a drag up claims the touch; down or sideways belongs to the sheet and the pages.
    activeOffsetY: [-SWIPE_SLOP, 1_000_000],
    failOffsetY: [-1_000_000, SWIPE_SLOP],
    failOffsetX: [-SWIPE_SLOP * 2, SWIPE_SLOP * 2],
    onActivate: () => {
      "worklet";
      scheduleOnRN(relatedRiseBegan);
    },
    onUpdate: (event) => {
      "worklet";
      if (still || height <= 0) return;
      related.set(Math.min(1, Math.max(0, -event.translationY / height)));
    },
    onDeactivate: (event) => {
      "worklet";
      // A touch taken away settles back where it started.
      const released = !event.canceled;
      scheduleOnRN(
        relatedRiseEnded,
        released ? event.translationY : 0,
        released ? event.velocityY : 0,
      );
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={style}>{children}</View>
    </GestureDetector>
  );
}

/** The mark's bar, and the touch target around it. */
const MARK = { width: CELL / 2, height: CELL * 7 } as const;
const MARK_TARGET = { width: grid.margin + CELL, height: CELL * 9 } as const;
/** On the player's right edge, a little above the middle. */
const MARK_PLACE = { position: "absolute", right: 0, top: "44%" } as const;

/**
 * A small bar on the player's right edge: the Queue is one swipe away. Screen
 * readers hear it as a button named Queue, which opens it. A drag up from it
 * raises Related, as from the rest of the player.
 */
export function QueueEdgeMark({ onPress }: { onPress: () => void }) {
  const { strings } = useLocalisation();
  const tertiary = useThemeColor("tertiary");
  return (
    <RelatedRiseArea style={[MARK_TARGET, MARK_PLACE]}>
      <Press
        accessibilityRole="button"
        accessibilityLabel={strings.playbackText.queue}
        onPress={onPress}
        haptic="selection"
        depth={0}
        className="items-end justify-center"
        style={MARK_TARGET}
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
    </RelatedRiseArea>
  );
}
