import {
  bounceDemoSwipe,
  resolveRowSwipe,
  RETURN_SPRINGS,
  rowSwipeArmed,
  swipeActionTone,
  type RowMenuAction,
  type RowSwipeSide,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useBounceSpring } from "@/motion/bounce";
import { handleSwipeSlop } from "@/motion/handleHold";
import { useListScrollable } from "@/motion/heldTouch";
import { ACTION_ICONS } from "@/playback/actionIcons";
import { useThemeColor } from "@/theme/useThemeColor";

import { CELL } from "./grid";

/** What one swipe direction of a song row runs: an entry of the row's long-press menu. */
export interface SwipeSide {
  readonly action: RowMenuAction;
  /** The short label the row uncovers ("Add to Queue", "Remove"). */
  readonly label: string;
  /** The menu entry's full label, which screen readers offer as the row's action. */
  readonly accessibilityLabel: string;
  /** The row leaves the list as it runs (Remove from Playlist): it slides out first. */
  readonly leaves: boolean;
  readonly run: () => void;
}

/** A row's swipe directions: null where the row doesn't move. */
export interface RowSwipe {
  /** Swiping right (the row uncovers its left edge). */
  readonly right: SwipeSide | null;
  readonly left: SwipeSide | null;
}

export const NO_SWIPE: RowSwipe = { right: null, left: null };

/**
 * Rows drawn over Now Playing's colours (its Related view): a row and what
 * its swipe uncovers have no background of their own. Elsewhere a row stays
 * on the screen's background.
 */
export const ClearRowsContext = createContext(false);

const DRAG_SLOP = 12;

/** The light tick a row gives as it arms. */
const tick = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
const SIDES: readonly RowSwipeSide[] = ["right", "left"];
const actionName = (side: RowSwipeSide): string => `swipe-${side}`;

/**
 * The swipes as screen-reader actions on the row, after [actions] (the
 * row's own, such as Move up in a playlist), and the handler that runs them
 * or passes the others to [onAction].
 */
export const swipeAccessibility = (
  swipe: RowSwipe,
  actions: readonly AccessibilityActionInfo[] | undefined,
  onAction: ((event: AccessibilityActionEvent) => void) | undefined,
): {
  readonly accessibilityActions: AccessibilityActionInfo[];
  readonly onAccessibilityAction: (event: AccessibilityActionEvent) => void;
} => ({
  accessibilityActions: [
    ...(actions ?? []),
    ...SIDES.flatMap((side) => {
      const action = swipe[side];
      return action === null ? [] : [{ name: actionName(side), label: action.accessibilityLabel }];
    }),
  ],
  onAccessibilityAction: (event) => {
    const side = SIDES.find((name) => actionName(name) === event.nativeEvent.actionName);
    const action = side === undefined ? null : swipe[side];
    if (action !== null) action.run();
    else onAction?.(event);
  },
});

/**
 * What a swipe uncovers on [side]'s edge: the action's icon and short label,
 * Primary, Secondary for a star, or red for a removal; full strength once armed.
 */
function Uncovered({
  action,
  edge,
  clear = false,
}: {
  action: SwipeSide;
  edge: "start" | "end";
  clear?: boolean;
}) {
  const tone = swipeActionTone(action.action);
  const colour = useThemeColor(tone);
  const Icon = ACTION_ICONS[action.action];
  const textClass = {
    accent: "text-accent",
    highlight: "text-highlight",
    destructive: "text-destructive",
  }[tone];
  return (
    <View
      className={`absolute inset-0 flex-row items-center ${clear ? "" : "bg-fill"} ${edge === "start" ? "justify-start" : "justify-end"}`}
      style={{ gap: CELL, paddingHorizontal: CELL * 2 }}
    >
      <Icon size={20} color={colour} strokeWidth={1.5} />
      <Text numberOfLines={1} className={`font-sans text-body font-medium ${textClass}`}>
        {action.label}
      </Text>
    </View>
  );
}

/**
 * What a clear row's swipe uncovers on [edge] (`ClearRowsContext`), with no
 * background: cut to the width the row has moved off, so it doesn't show
 * through the row.
 */
function ClearUncovered({
  action,
  edge,
  offsetX,
  width,
}: {
  action: SwipeSide;
  edge: "start" | "end";
  offsetX: SharedValue<number>;
  width: SharedValue<number>;
}) {
  const uncovered = useAnimatedStyle(() => ({
    width: Math.max(0, edge === "start" ? offsetX.get() : -offsetX.get()),
  }));
  // The action keeps its place on the whole row's width as more of it shows.
  const row = useAnimatedStyle(() => ({ width: width.get() }));
  const side = edge === "start" ? "left-0" : "right-0";
  return (
    <Animated.View className={`absolute bottom-0 top-0 overflow-hidden ${side}`} style={uncovered}>
      <Animated.View className={`absolute bottom-0 top-0 ${side}`} style={row}>
        <Uncovered action={action} edge={edge} clear />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * A cheap stand-in for [Edges] from the row's mount: each edge's colour and
 * icon on its half of the row, with no animated style, so a swipe that moves
 * the row (on the UI thread) before the touch's render commits never uncovers
 * blank (#1423). Full strength; [Edges] replaces it once mounted.
 */
function Backdrop({ swipe }: { swipe: RowSwipe }) {
  return (
    <>
      {swipe.right !== null && <BackdropSide action={swipe.right} edge="start" />}
      {swipe.left !== null && <BackdropSide action={swipe.left} edge="end" />}
    </>
  );
}

function BackdropSide({ action, edge }: { action: SwipeSide; edge: "start" | "end" }) {
  const colour = useThemeColor(swipeActionTone(action.action));
  const Icon = ACTION_ICONS[action.action];
  return (
    <View
      pointerEvents="none"
      className={`absolute bottom-0 top-0 w-1/2 flex-row items-center bg-fill ${edge === "start" ? "left-0 justify-start" : "right-0 justify-end"}`}
      style={{ paddingHorizontal: CELL * 2 }}
    >
      <Icon size={20} color={colour} strokeWidth={1.5} />
    </View>
  );
}

/**
 * What a row's swipe uncovers on both edges, each showing while the row moves
 * off it, faint until armed. Mounted on the row's first touch or demo (#1423),
 * over [Backdrop] until then; a clear row's at mount, as nothing can stand in
 * behind a row with no background.
 */
function Edges({
  swipe,
  clear,
  offsetX,
  width,
}: {
  swipe: RowSwipe;
  clear: boolean;
  offsetX: SharedValue<number>;
  width: SharedValue<number>;
}) {
  const strength = (moved: number) => {
    "worklet";
    return moved <= 0 ? 0 : rowSwipeArmed({ translationX: moved, width: width.get() }) ? 1 : 0.5;
  };
  const rightStyle = useAnimatedStyle(() => ({ opacity: strength(offsetX.get()) }));
  const leftStyle = useAnimatedStyle(() => ({ opacity: strength(-offsetX.get()) }));
  return (
    <>
      {swipe.right !== null && (
        <Animated.View pointerEvents="none" className="absolute inset-0" style={rightStyle}>
          {clear ? (
            <ClearUncovered action={swipe.right} edge="start" offsetX={offsetX} width={width} />
          ) : (
            <Uncovered action={swipe.right} edge="start" />
          )}
        </Animated.View>
      )}
      {swipe.left !== null && (
        <Animated.View pointerEvents="none" className="absolute inset-0" style={leftStyle}>
          {clear ? (
            <ClearUncovered action={swipe.left} edge="end" offsetX={offsetX} width={width} />
          ) : (
            <Uncovered action={swipe.left} edge="end" />
          )}
        </Animated.View>
      )}
    </>
  );
}

/**
 * A song row that swipes sideways to run an action of its menu ([swipe]):
 * past a third of its width it arms with a light tick, letting go runs the
 * action, letting go sooner springs back, swinging past its rest as far as
 * the Bounce amount says (none at 0%; with reduce motion, it goes back at
 * once). The threshold is the finger's travel at every amount. A direction without an action doesn't move. Vertical drags stay
 * the list's; taps and long-presses stay the row's. No swipe while
 * [enabled] is false (selection mode) or while a long-pressed finger slides
 * to choose in a menu. A swipe can't begin on the [handleWidth] dp at the
 * row's end, where its drag handle is.
 *
 * A [sample] row (Settings › Appearance › Motion's) swipes the same way but
 * runs nothing: it moves both ways, uncovering and arming only towards a
 * side with an action, and letting go always springs it back. Each change
 * of [demo] after the first render plays one short swipe and spring by
 * itself (Core's `bounceDemoSwipe`; none under reduce motion).
 *
 * Under `ClearRowsContext` the row and what it uncovers have no background.
 */
export function SwipeableRow({
  swipe,
  enabled = true,
  sample = false,
  demo = 0,
  handleWidth = 0,
  children,
}: {
  swipe: RowSwipe;
  enabled?: boolean;
  sample?: boolean;
  demo?: number;
  handleWidth?: number | undefined;
  children: ReactNode;
}) {
  const scrollable = useListScrollable();
  const clear = useContext(ClearRowsContext);
  const reduceMotion = useReducedMotion();
  const spring = useBounceSpring(RETURN_SPRINGS.swipeRow);
  const canRight = swipe.right !== null;
  const canLeft = swipe.left !== null;
  const movesRight = sample || canRight;
  const movesLeft = sample || canLeft;
  const active = enabled && scrollable && (movesRight || movesLeft);

  const offsetX = useSharedValue(0);
  const width = useSharedValue(1);
  const widthRef = useRef(1);
  // The latest actions, for a swipe that ends after the row re-rendered.
  const swipeRef = useRef(swipe);
  useLayoutEffect(() => {
    swipeRef.current = swipe;
  });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.get() }],
  }));
  // What a swipe uncovers is drawn in full from the first touch (well before
  // the drag slop is crossed) or demo on, and kept; [Backdrop] stands in until then.
  const [uncovering, setUncovering] = useState(false);
  const [firstDemo] = useState(demo);
  if (demo !== firstDemo && !uncovering) setUncovering(true);

  const settle = () => {
    offsetX.set(reduceMotion ? 0 : withSpring(0, spring));
  };

  // The spring and motion setting as of the latest render, for a demo asked for in the same commit.
  const motion = useRef({ spring, reduceMotion });
  useLayoutEffect(() => {
    motion.current = { spring, reduceMotion };
  });
  useEffect(() => {
    if (demo === firstDemo) return;
    const plan = bounceDemoSwipe({
      width: widthRef.current,
      reduceMotion: motion.current.reduceMotion,
    });
    if (plan === null) return;
    offsetX.set(
      withSequence(
        withTiming(plan.translationX, { duration: plan.outMs }),
        withSpring(0, motion.current.spring),
      ),
    );
  }, [demo, firstDemo, offsetX]);

  const finish = (translationX: number, velocityX: number, canceled: boolean) => {
    const side =
      sample || canceled
        ? null
        : resolveRowSwipe(
            { translationX, velocityX, width: widthRef.current },
            { right: swipeRef.current.right !== null, left: swipeRef.current.left !== null },
          );
    const action = side === null ? null : swipeRef.current[side];
    if (side === null || action === null) {
      settle();
      return;
    }
    if (!action.leaves || reduceMotion) {
      if (!action.leaves) settle();
      action.run();
      return;
    }
    const away = side === "left" ? -widthRef.current : widthRef.current;
    offsetX.set(
      withTiming(away, { duration: 160 }, (finished) => {
        if (finished) scheduleOnRN(action.run);
      }),
    );
  };

  /** The side the row arms at [moved]: a sample arms only towards a side with an action to uncover. */
  const armedSide = (moved: number): RowSwipeSide | null => {
    "worklet";
    const reached = rowSwipeArmed({ translationX: moved, width: width.get() });
    return reached === null || (reached === "right" ? canRight : canLeft) ? reached : null;
  };

  const pan = usePanGesture({
    enabled: active,
    hitSlop: handleSwipeSlop(handleWidth),
    // Only towards the sides with an action; a vertical move belongs to the list.
    activeOffsetX:
      movesRight && movesLeft ? [-DRAG_SLOP, DRAG_SLOP] : movesRight ? DRAG_SLOP : -DRAG_SLOP,
    failOffsetY: [-DRAG_SLOP, DRAG_SLOP],
    onUpdate: (event) => {
      "worklet";
      const x = event.translationX;
      const shown = (x > 0 && movesRight) || (x < 0 && movesLeft) ? x : 0;
      // The side armed before this move follows from where the row was, so a row
      // keeps no shared value of its own for it (#1441).
      const was = armedSide(offsetX.get());
      offsetX.set(shown);
      const now = armedSide(shown);
      if (now !== null && now !== was) scheduleOnRN(tick);
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(finish, event.translationX, event.velocityX, event.canceled);
    },
  });

  return (
    <View
      onLayout={(event) => {
        const measured = Math.max(1, event.nativeEvent.layout.width);
        widthRef.current = measured;
        width.set(measured);
      }}
      onTouchStart={active && !uncovering ? () => setUncovering(true) : undefined}
    >
      {uncovering || clear ? (
        <Edges swipe={swipe} clear={clear} offsetX={offsetX} width={width} />
      ) : (
        <Backdrop swipe={swipe} />
      )}
      <GestureDetector gesture={pan}>
        <Animated.View className={clear ? undefined : "bg-background"} style={contentStyle}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
