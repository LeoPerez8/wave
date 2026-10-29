import { playerErrorNotice } from "@wave/core";
import { useLocalisation } from "@/localisation/localisation";
import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerTrackNextFilled,
} from "@tabler/icons-react-native";
import {
  concentricRadius,
  playerTouchAllowed,
  resolveSkipSwipe,
  RETURN_SPRINGS,
  type SkipDirection,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { memo, useEffect, useRef, useSyncExternalStore, type ComponentRef } from "react";
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
import { OnFloatingChrome } from "@/chrome/onFloatingChrome";
import { IconButton } from "@/components/IconButton";
import { Glass } from "@/glass/Glass";
import { useBounceSpring } from "@/motion/bounce";
import { Press } from "@/motion/Press";
import { menuTouchOwnership, observeMenuTouchOwnership } from "@/motion/heldTouch";
import {
  beginNowPlayingDrag,
  endNowPlayingDrag,
  sheetHeight,
  sheetOffset,
} from "@/nowPlaying/sheet";

import { skipToNext, skipToPrevious, togglePlayPause } from "./actions";
import { playbackState } from "./Player";
import { openPlayingActions } from "./ActionsMenu";
import { useRenderCount } from "@/perf/perf";

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

const beginOpen = (revision: number) => {
  if (menuTouchOwnership.allows(revision)) beginNowPlayingDrag();
};

const finishOpen = (
  revision: number,
  translationY: number,
  velocityY: number,
  canceled: boolean,
) => {
  if (!menuTouchOwnership.allows(revision)) return;
  endNowPlayingDrag(canceled ? 0 : translationY, canceled ? 0 : velocityY);
};

// Separate selectors, so position ticks don't re-render the mini player.
const usePlaybackField = <K extends "item" | "playWhenReady" | "error" | "errorCode">(key: K) =>
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
 * it for Now Playing, swipe it up for Now Playing too. A long press opens the
 * playing song's action card, floating beside the pill. It floats above the tab
 * bar, or above the system inset on screens without one. Memoized: the layouts holding it render on
 * navigation, and it needn't (pass a stable `onOpen`).
 */
export const MiniPlayer = memo(function MiniPlayer({ backdropId, onOpen }: Props) {
  const { strings } = useLocalisation();
  useRenderCount("MiniPlayer");
  const item = usePlaybackField("item");
  const playing = usePlaybackField("playWhenReady");
  const error = usePlaybackField("error");
  const code = usePlaybackField("errorCode");
  const bottom = useTabBarTop();
  const reduceMotion = useReducedMotion();
  // A swipe let go short springs back as far past rest as the Bounce amount says.
  const spring = useBounceSpring(RETURN_SPRINGS.miniPlayer);
  // The pill, which the song's card (on a long press) floats beside and highlights.
  const pill = useRef<ComponentRef<typeof View>>(null);

  const width = useSharedValue(1);
  const widthRef = useRef(1);
  const offset = useSharedValue(0);
  const ownership = useSharedValue(menuTouchOwnership.get());
  const pansEnabled = useSharedValue(!menuTouchOwnership.get().held);
  const skipRevision = useSharedValue(-1);
  const openRevision = useSharedValue(-1);

  useEffect(
    () =>
      observeMenuTouchOwnership((owner) => {
        // Disable the native recognizers before an anchor/song read can finish.
        // Revision checks also reject UI/RN callbacks already in flight.
        ownership.set(owner);
        pansEnabled.set(!owner.held);
        if (owner.held) {
          offset.set(0);
          endNowPlayingDrag(0, 0);
        }
      }),
    [ownership, pansEnabled, offset],
  );

  const finish = (revision: number, translationX: number, velocityX: number, canceled: boolean) => {
    if (!menuTouchOwnership.allows(revision)) return;
    const direction = canceled
      ? null
      : resolveSkipSwipe({ translationX, velocityX, width: widthRef.current });
    if (direction === null) {
      offset.set(withSpring(0, spring));
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
    enabled: pansEnabled,
    activeOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    failOffsetY: [-DRAG_SLOP, DRAG_SLOP],
    onBegin: () => {
      "worklet";
      const owner = ownership.get();
      skipRevision.set(owner.held ? -1 : owner.revision);
    },
    onUpdate: (event) => {
      "worklet";
      if (!playerTouchAllowed(ownership.get(), skipRevision.get())) return;
      offset.set(event.translationX);
    },
    onDeactivate: (event) => {
      "worklet";
      const revision = skipRevision.get();
      if (!playerTouchAllowed(ownership.get(), revision)) return;
      scheduleOnRN(finish, revision, event.translationX, event.velocityX, event.canceled);
    },
  });

  // Swiping up pulls Now Playing out of the mini player, following the finger.
  const openPan = usePanGesture({
    enabled: pansEnabled,
    activeOffsetY: [-DRAG_SLOP, 1_000_000],
    failOffsetX: [-DRAG_SLOP, DRAG_SLOP],
    onBegin: () => {
      "worklet";
      const owner = ownership.get();
      openRevision.set(owner.held ? -1 : owner.revision);
    },
    onActivate: () => {
      "worklet";
      const revision = openRevision.get();
      if (!playerTouchAllowed(ownership.get(), revision)) return;
      scheduleOnRN(beginOpen, revision);
    },
    onUpdate: (event) => {
      "worklet";
      if (!playerTouchAllowed(ownership.get(), openRevision.get())) return;
      const height = sheetHeight.get();
      sheetOffset.set(Math.min(height, Math.max(0, height + event.translationY)));
    },
    onDeactivate: (event) => {
      "worklet";
      const revision = openRevision.get();
      if (!playerTouchAllowed(ownership.get(), revision)) return;
      scheduleOnRN(finishOpen, revision, event.translationY, event.velocityY, event.canceled);
    },
  });

  const contentStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(offset.get()) / width.get()) * 0.8,
    transform: [{ translateX: offset.get() }],
  }));

  if (item === null) return null;
  const title = item.title ?? strings.playbackText.unknownTitle;
  const subtitle =
    error === null
      ? (item.artist ?? strings.playbackText.unknownArtist)
      : playerErrorNotice(code, strings);

  return (
    <OnFloatingChrome value>
      <GestureDetector gesture={openPan}>
        <View
          pointerEvents="box-none"
          className="absolute"
          ref={pill}
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
                  accessibilityLabel={strings.playbackText.nowPlayingValueValue(title, subtitle)}
                  accessibilityHint={strings.playbackText.opensNowPlaying}
                  accessibilityActions={[
                    { name: "next", label: strings.playbackText.nextTrack },
                    { name: "previous", label: strings.playbackText.previousTrack },
                  ]}
                  onAccessibilityAction={(event) =>
                    skip(event.nativeEvent.actionName === "next" ? "next" : "previous")
                  }
                  onPress={onOpen}
                  onLongPress={openPlayingActions}
                  highlightAs={{ view: pill, radius: RADIUS }}
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
                    label={
                      playing
                        ? strings.playbackText.pauseValue(title)
                        : strings.playbackText.playValue(title)
                    }
                    onPress={togglePlayPause}
                  />
                  <IconButton
                    icon={IconPlayerTrackNextFilled}
                    label={strings.playbackText.nextTrack}
                    onPress={skipToNext}
                  />
                </View>
              </Animated.View>
            </GestureDetector>
          </View>
        </View>
      </GestureDetector>
    </OnFloatingChrome>
  );
});
