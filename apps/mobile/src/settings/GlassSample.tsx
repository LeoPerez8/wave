import { StyleSheet, Text, View } from "react-native";

import { GlassSurface } from "@/glass/Glass";

import { useGlassSettings } from "./glass";

/** The sample's backdrop; nothing else on screen has it while Appearance is open. */
const BACKDROP_ID = "glass-sample-backdrop";
const CARD_RADIUS = 24;

/** The backdrop's stripes, the same in every theme so each level reads the same every time. */
const STRIPES = [
  "#FF3B30",
  "#FF9500",
  "#FFCC00",
  "#34C759",
  "#00C7BE",
  "#007AFF",
  "#5856D6",
  "#AF52DE",
  "#FF2D55",
  "#A2845E",
] as const;

/** Lines of thin and bold text across the stripes: blur softens them, refraction bends them at the card's edge. */
const LINES = [
  { text: "The quick brown fox jumps over the lazy dog", color: "#FFFFFF", bold: false },
  { text: "WAVE WAVE WAVE WAVE WAVE WAVE", color: "#000000", bold: true },
  { text: "Sphinx of black quartz, judge my vow", color: "#FFFFFF", bold: false },
  { text: "WAVE WAVE WAVE WAVE WAVE WAVE", color: "#FFFFFF", bold: true },
  { text: "The quick brown fox jumps over the lazy dog", color: "#000000", bold: false },
] as const;

/**
 * Settings › Appearance › Glass's sample: a glass card over a fixed, busy
 * backdrop, drawn with the glass settings as they change, while the app's own
 * glass waits until Appearance is left (`holdAppliedGlass`). Below Android 12
 * the card is the opaque surface the app's glass is there.
 */
export function GlassSample() {
  const glass = useGlassSettings();

  return (
    <View
      className="h-44 overflow-hidden rounded-2xl"
      accessible
      accessibilityRole="image"
      accessibilityLabel="Sample glass card over coloured stripes, drawn with the settings below"
    >
      <View nativeID={BACKDROP_ID} collapsable={false} style={StyleSheet.absoluteFill}>
        <View className="flex-1 flex-row">
          {STRIPES.map((color) => (
            <View key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </View>
        <View className="absolute inset-0 justify-around px-3 py-2">
          {LINES.map(({ text, color, bold }, index) => (
            <Text
              key={index}
              numberOfLines={1}
              className={`font-sans ${bold ? "text-title3 font-bold" : "text-footnote"}`}
              style={{ color }}
            >
              {text}
            </Text>
          ))}
        </View>
      </View>
      <View className="absolute inset-x-8 top-10 bottom-10 items-center justify-center">
        <GlassSurface backdropId={BACKDROP_ID} cornerRadius={CARD_RADIUS} glass={glass} />
        <Text className="font-sans text-body font-semibold text-foreground">Glass</Text>
      </View>
    </View>
  );
}
