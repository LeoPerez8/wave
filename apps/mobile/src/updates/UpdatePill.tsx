import { IconDownload } from "@tabler/icons-react-native";
import { RETURN_SPRINGS, updatePillShown, updatePillSwipeDismisses } from "@wave/core";
import { useRef, useSyncExternalStore } from "react";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CELL } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { FloatingPillLook, listPillsUp } from "@/components/FloatingPill";
import { useLocalisation } from "@/localisation/localisation";
import { useBounceSpring } from "@/motion/bounce";
import { useNowPlayingShown } from "@/nowPlaying/sheet";
import { isOverlayOpen, onOverlaysChange } from "@/overlay/overlay";

import {
  ignoreAppUpdate,
  installAppUpdate,
  useIgnoredAppUpdate,
  useOfferedAppUpdate,
} from "./appUpdates";

/** Travel before a drag takes over from a tap, in dp. */
const DRAG_SLOP = CELL * 1.5;

/** How long the pill takes to leave along the swipe, in ms. */
const SWIPE_OUT_MS = 160;

const ACCESSIBILITY_IGNORE = "ignore";

/** Offers a downloaded APK, above the mini player. Core's `updatePillShown` says when. */
export function UpdatePill() {
  const offered = useOfferedAppUpdate();
  const ignored = useIgnoredAppUpdate();
  const nowPlayingShown = useNowPlayingShown();
  const cardOpen = useSyncExternalStore(onOverlaysChange, isOverlayOpen);
  const otherPillShown = useSyncExternalStore(listPillsUp.subscribe, listPillsUp.get) > 0;
  const shown = updatePillShown({ offered, ignored, nowPlayingShown, cardOpen, otherPillShown });
  return shown ? <SwipeablePill /> : null;
}

/** Mounts afresh each time it shows, so a pill swiped away comes back in place. */
function SwipeablePill() {
  const { strings } = useLocalisation();
  const bottom = useChromeInset();
  const reduceMotion = useReducedMotion();
  const spring = useBounceSpring(RETURN_SPRINGS.miniPlayer);
  const offset = useSharedValue(0);
  const width = useSharedValue(1);
  const widthRef = useRef(1);

  const endDrag = (translationX: number, velocityX: number, canceled: boolean) => {
    const size = widthRef.current;
    if (canceled || !updatePillSwipeDismisses({ translationX, velocityX, width: size })) {
      offset.set(withSpring(0, spring));
      return;
    }
    if (!reduceMotion) {
      offset.set(withTiming(Math.sign(translationX) * size, { duration: SWIPE_OUT_MS }));
    }
    ignoreAppUpdate();
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
      scheduleOnRN(endDrag, event.translationX, event.velocityX, event.canceled);
    },
  });

  const style = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(offset.get()) / width.get()),
    transform: [{ translateX: offset.get() }],
  }));

  return (
    <FloatingPillLook
      icon={IconDownload}
      label={strings.appUpdates.updateTheApp}
      bottom={bottom}
      onPress={installAppUpdate}
      accessibilityActions={[
        { name: "activate" },
        { name: ACCESSIBILITY_IGNORE, label: strings.appUpdates.ignoreThisUpdate },
      ]}
      onAccessibilityAction={(event) =>
        event.nativeEvent.actionName === ACCESSIBILITY_IGNORE
          ? ignoreAppUpdate()
          : installAppUpdate()
      }
      wrapButton={(button) => (
        <GestureDetector gesture={pan}>
          <Animated.View
            onLayout={({ nativeEvent: { layout } }) => {
              widthRef.current = Math.max(1, layout.width);
              width.set(widthRef.current);
            }}
            style={style}
          >
            {button}
          </Animated.View>
        </GestureDetector>
      )}
    />
  );
}
