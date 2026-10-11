import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { useTapAnimationMs } from "@/settings/tapAnimation";
import { useThemeColor } from "@/theme/useThemeColor";

import { CATALOG_TRACKING, CELL, grid } from "./grid";

const HIT_WIDTH = CELL * 6;

type Props = {
  /** Letters present in the list, in order ("#" for digits and symbols). */
  letters: readonly string[];
  /** Called once per letter change while scrubbing; scroll the list there. */
  onLetter: (letter: string) => void;
};

/**
 * Wave's signature move: a thin, tracked A–Z spine on the right edge. Dragging
 * it sets one huge letter quietly in the field, with a haptic tick per letter.
 */
export function AlphabetSpine({ letters, onLetter }: Props) {
  const ms = useTapAnimationMs();
  const background = useThemeColor("background");
  const [active, setActive] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const height = useRef(0);

  const select = (y: number) => {
    if (letters.length === 0 || height.current <= CELL * 2) return;
    const index = Math.min(
      letters.length - 1,
      Math.max(0, Math.floor(((y - CELL) / (height.current - CELL * 2)) * letters.length)),
    );
    const letter = letters[index];
    if (letter === undefined || letter === activeRef.current) return;
    activeRef.current = letter;
    setActive(letter);
    void Haptics.selectionAsync();
    onLetter(letter);
  };

  const release = () => {
    activeRef.current = null;
    setActive(null);
  };

  const pan = usePanGesture({
    minDistance: 0,
    runOnJS: true,
    onBegin: (event) => select(event.y),
    onUpdate: (event) => select(event.y),
    onFinalize: release,
  });

  const step = (direction: 1 | -1) => {
    const current = activeRef.current === null ? -1 : letters.indexOf(activeRef.current);
    const letter = letters[Math.min(letters.length - 1, Math.max(0, current + direction))];
    if (letter === undefined) return;
    activeRef.current = letter;
    onLetter(letter);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {active !== null && (
        <Animated.View
          pointerEvents="none"
          entering={FadeIn.duration(ms)}
          exiting={FadeOut.duration(ms * 2)}
          style={[
            StyleSheet.absoluteFill,
            // The ground at 90%, so the letter sits in the field over the list.
            { alignItems: "center", justifyContent: "center", backgroundColor: `${background}E6` },
          ]}
        >
          <Text className="font-sans text-index font-light text-foreground">{active}</Text>
        </Animated.View>
      )}
      <View pointerEvents="box-none" className="absolute bottom-0 right-0 top-0 justify-center">
        <GestureDetector gesture={pan}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Alphabet index"
            accessibilityValue={{ text: active ?? letters[0] ?? "" }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(event) =>
              step(event.nativeEvent.actionName === "increment" ? 1 : -1)
            }
            onLayout={(event) => {
              height.current = event.nativeEvent.layout.height;
            }}
            // The touch target is wider than the drawn spine (48dp minimum).
            style={{ width: HIT_WIDTH, paddingLeft: HIT_WIDTH - grid.spine, paddingVertical: CELL }}
          >
            {letters.map((letter) => (
              <Text
                key={letter}
                className={`text-center font-sans text-[10px] font-semibold leading-[14px] ${
                  letter === active ? "text-accent" : "text-secondary"
                }`}
                style={{ letterSpacing: CATALOG_TRACKING / 2 }}
              >
                {letter}
              </Text>
            ))}
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}
