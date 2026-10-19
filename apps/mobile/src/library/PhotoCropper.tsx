/**
 * The crop screen of a playlist's image (docs/spec.md, story 54): Change
 * Image opens it on the picked photo, Adjust Image on the original at the
 * last framing. The photo moves under a fixed square, dragged and pinched
 * (Core's `panFraming`, `pinchFraming`, run on the UI thread); outside the
 * square it shows dimmed. Done resolves the framing, Cancel or Back null.
 */
import {
  CENTRE_FRAMING,
  framingView,
  panFraming,
  pinchFraming,
  type ImageFraming,
} from "@wave/core";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Modal, Text, useWindowDimensions, View } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { makeExternalStore } from "@/lib/externalStore";
import type { PlaylistPhoto } from "@/native/waveNative";

import type { FramePhoto } from "./playlists";

interface CropRequest {
  readonly photo: PlaylistPhoto;
  readonly framing: ImageFraming;
  readonly done: (framing: ImageFraming | null) => void;
}

/** The photo being framed, while the crop screen is up (`PhotoCropperHost` draws it). */
const request = makeExternalStore<CropRequest | null>(null);

/** Opens the crop screen on [photo] at [framing]; resolves the framing on Done, null on Cancel. */
export const framePhoto: FramePhoto = (photo, framing) =>
  new Promise((resolve) => {
    // A crop screen already up (a second tap) gives way to the new one.
    request.get()?.done(null);
    request.set({
      photo,
      framing,
      done: (chosen) => {
        request.set(null);
        resolve(chosen);
      },
    });
  });

/** Draws the crop screen while it's up; mounted once at the root. */
export function PhotoCropperHost() {
  const current = useSyncExternalStore(request.subscribe, request.get);
  return current === null ? null : <CropScreen key={current.photo.path} request={current} />;
}

/** Room around the crop square, in dp. */
const SQUARE_MARGIN = grid.margin;

function CropScreen({ request: { photo, framing: start, done } }: { request: CropRequest }) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState({ width: window.width, height: window.height });
  const side = Math.max(1, Math.min(stage.width, stage.height) - SQUARE_MARGIN * 2);
  const squareLeft = (stage.width - side) / 2;
  const squareTop = (stage.height - side) / 2;

  const size = { width: photo.width, height: photo.height };
  const framing = useSharedValue<ImageFraming>(start);

  const pan = usePanGesture({
    onUpdate: (event) => {
      "worklet";
      framing.set(panFraming(size, side, framing.get(), event.changeX, event.changeY));
    },
  });
  const pinch = usePinchGesture({
    onUpdate: (event) => {
      "worklet";
      framing.set(
        pinchFraming(
          size,
          side,
          framing.get(),
          event.scaleChange,
          event.focalX - squareLeft,
          event.focalY - squareTop,
        ),
      );
    },
  });
  const gestures = useSimultaneousGestures(pan, pinch);

  // Laid out at zoom 1 and scaled from its top-left corner, so a frame only changes the transform.
  const base = framingView(size, side, CENTRE_FRAMING).scale;
  const photoStyle = useAnimatedStyle(() => {
    const view = framingView(size, side, framing.get());
    return {
      transform: [
        { translateX: squareLeft + view.translateX },
        { translateY: squareTop + view.translateY },
        { scale: view.scale / base },
      ],
    };
  });

  const cancel = useCallback(() => done(null), [done]);
  const finish = useCallback(() => done(framing.get()), [done, framing]);

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancel}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View
          accessibilityViewIsModal
          className="flex-1 bg-background"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <View
            className="flex-row items-center justify-between"
            style={{ paddingHorizontal: grid.margin }}
          >
            <TextButton label="Cancel" onPress={cancel} />
            <Text
              accessibilityRole="header"
              className="font-sans text-body font-medium text-foreground"
            >
              Move and Scale
            </Text>
            <TextButton label="Done" onPress={finish} />
          </View>
          <GestureDetector gesture={gestures}>
            <View
              className="flex-1 overflow-hidden"
              accessible
              accessibilityLabel="Photo. Drag to move it, pinch to zoom."
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                setStage({ width, height });
              }}
            >
              <Animated.Image
                source={{ uri: `file://${photo.path}` }}
                resizeMode="stretch"
                style={[
                  {
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: photo.width * base,
                    height: photo.height * base,
                    transformOrigin: "top left",
                  },
                  photoStyle,
                ]}
              />
              <Dim left={0} top={0} width={stage.width} height={squareTop} />
              <Dim left={0} top={squareTop + side} width={stage.width} height={squareTop} />
              <Dim left={0} top={squareTop} width={squareLeft} height={side} />
              <Dim left={squareLeft + side} top={squareTop} width={squareLeft} height={side} />
              <View
                pointerEvents="none"
                className="border-foreground"
                style={{
                  position: "absolute",
                  left: squareLeft,
                  top: squareTop,
                  width: side,
                  height: side,
                  borderWidth: 1,
                  borderRadius: CELL / 2,
                }}
              />
            </View>
          </GestureDetector>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** The photo outside the crop square, faded toward the screen's ground. */
function Dim(frame: { left: number; top: number; width: number; height: number }) {
  return (
    <View
      pointerEvents="none"
      className="bg-background"
      style={{ position: "absolute", opacity: 0.6, ...frame }}
    />
  );
}
