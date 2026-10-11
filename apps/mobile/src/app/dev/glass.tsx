import { makeImageFromView, type SkImage } from "@shopify/react-native-skia";
import { IconHome, IconSearch, IconStack2 } from "@tabler/icons-react-native";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from "react-native";
import Animated, {
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FrameStatsHud } from "@/dev/glass/FrameStatsHud";
import { SkiaGlass, type Frame } from "@/dev/glass/SkiaGlass";
import { NativeGlassView } from "@/dev/glass/waveGlass";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * Spike (#4): compares glass techniques for the tab bar over colourful
 * scrolling content, with a frame-time readout. Throwaway; see docs/glass-spike.md.
 */

type Technique = "native" | "native-blur" | "skia" | "plain";

const TECHNIQUES: readonly { id: Technique; label: string }[] = [
  { id: "native", label: "A · Native refraction" },
  { id: "native-blur", label: "Fallback · Blur + tint + rim" },
  { id: "skia", label: "B · Skia snapshot" },
  { id: "plain", label: "Baseline · No blur" },
];

const BACKDROP_ID = "glass-spike-backdrop";
const BLUR = 24;
const REFRACTION = 12;
const TAB_BAR_HEIGHT = 64;
const AUTO_SCROLL_DP_PER_S = 1400;

const hue = (i: number): string => `hsl(${(i * 47) % 360}, 75%, 55%)`;

/** Colourful, high-contrast rows so blur and edge refraction are easy to judge. */
function SpikeContent() {
  return (
    <View className="gap-3 px-4 pb-40">
      {Array.from({ length: 48 }, (_, i) => (
        <View key={i} className="gap-2">
          <View className="h-28 overflow-hidden rounded-2xl" style={{ backgroundColor: hue(i) }}>
            <Text className="p-4 font-sans text-title1 font-bold text-white">Row {i + 1}</Text>
            <View className="absolute bottom-3 left-4 right-4 flex-row gap-1">
              {Array.from({ length: 24 }, (_, j) => (
                <View
                  key={j}
                  className="h-6 flex-1"
                  style={{ backgroundColor: j % 2 === 0 ? "#000" : "#fff" }}
                />
              ))}
            </View>
          </View>
          <Text className="font-sans text-body text-foreground">
            The quick brown fox jumps over the lazy dog — thin text shows refraction best.
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function GlassSpikeScreen() {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const scheme = useColorScheme();
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");

  const [technique, setTechnique] = useState<Technique>("native");
  const [autoScroll, setAutoScroll] = useState(false);
  const [snapshot, setSnapshot] = useState<SkImage | null>(null);
  const [snapshotMs, setSnapshotMs] = useState<number | null>(null);
  const [contentSize, setContentSize] = useState({ width: window.width, height: 0 });

  // Room for the controls floating at the top.
  const contentTop = insets.top + 150;
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const contentRef = useRef<View>(null);
  const scrollY = useSharedValue(0);
  const direction = useSharedValue(1);
  const maxScroll = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const autoScroller = useFrameCallback((frame) => {
    "worklet";
    const dt = (frame.timeSincePreviousFrame ?? 0) / 1000;
    let next = scrollY.value + direction.value * AUTO_SCROLL_DP_PER_S * dt;
    if (next >= maxScroll.value) {
      next = maxScroll.value;
      direction.value = -1;
    } else if (next <= 0) {
      next = 0;
      direction.value = 1;
    }
    scrollTo(scrollRef, 0, next, false);
  }, false);

  useEffect(() => {
    autoScroller.setActive(autoScroll);
  }, [autoScroll, autoScroller]);

  useEffect(() => {
    maxScroll.value = Math.max(0, contentTop + contentSize.height - window.height);
  }, [contentTop, contentSize.height, window.height, maxScroll]);

  const takeSnapshot = useCallback(async () => {
    const started = performance.now();
    const image = await makeImageFromView(contentRef);
    setSnapshotMs(performance.now() - started);
    setSnapshot(image);
  }, []);

  // Technique B needs a snapshot of the content, retaken when the theme changes its colours.
  useEffect(() => {
    if (technique !== "skia" || contentSize.height === 0) return;
    const timer = setTimeout(() => void takeSnapshot(), 100);
    return () => clearTimeout(timer);
  }, [technique, contentSize.height, scheme, takeSnapshot]);

  const frame: Frame = {
    x: 16,
    y: window.height - insets.bottom - 12 - TAB_BAR_HEIGHT,
    width: window.width - 32,
    height: TAB_BAR_HEIGHT,
  };
  const tint = scheme === "dark" ? "rgba(30,30,30,0.35)" : "rgba(255,255,255,0.35)";
  const frameStyle = {
    position: "absolute" as const,
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
  };

  return (
    <View className="flex-1 bg-background">
      <View nativeID={BACKDROP_ID} collapsable={false} style={StyleSheet.absoluteFill}>
        <Animated.ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={1}
          contentContainerStyle={{ paddingTop: contentTop }}
        >
          <View
            ref={contentRef}
            collapsable={false}
            className="bg-background"
            onLayout={(event) => setContentSize(event.nativeEvent.layout)}
          >
            <SpikeContent />
          </View>
        </Animated.ScrollView>
      </View>

      {technique === "native" || technique === "native-blur" ? (
        <NativeGlassView
          style={frameStyle}
          backdropNativeId={BACKDROP_ID}
          blurRadius={BLUR}
          refraction={technique === "native" ? REFRACTION : 0}
          cornerRadius={TAB_BAR_HEIGHT / 2}
          tintColor={tint}
          rim
        />
      ) : null}
      {technique === "skia" ? (
        <SkiaGlass
          snapshot={snapshot}
          contentSize={contentSize}
          scrollY={scrollY}
          contentTop={contentTop}
          frame={frame}
          blurRadius={BLUR}
          refraction={REFRACTION}
          cornerRadius={TAB_BAR_HEIGHT / 2}
          tint={tint}
        />
      ) : null}
      {technique === "plain" ? (
        <View
          style={[
            frameStyle,
            {
              borderRadius: TAB_BAR_HEIGHT / 2,
              backgroundColor: scheme === "dark" ? "rgba(28,28,30,0.92)" : "rgba(255,255,255,0.92)",
            },
          ]}
        />
      ) : null}

      {/* Tab items on top of whichever glass is shown. */}
      <View pointerEvents="none" className="flex-row items-center justify-around" style={frameStyle}>
        {[
          { label: "Home", Icon: IconHome, active: true },
          { label: "Library", Icon: IconStack2, active: false },
          { label: "Search", Icon: IconSearch, active: false },
        ].map(({ label, Icon, active }) => (
          <View key={label} className="items-center gap-0.5">
            <Icon size={24} color={active ? accent : secondary} strokeWidth={1.75} />
            <Text
              className="font-sans text-caption font-semibold"
              style={{ color: active ? accent : secondary }}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View className="absolute left-3 right-3 gap-2" style={{ top: insets.top + 8 }}>
        <View className="flex-row flex-wrap gap-2">
          {TECHNIQUES.map(({ id, label }) => (
            <Pressable
              key={id}
              onPress={() => setTechnique(id)}
              className={`rounded-full px-3 py-1.5 ${technique === id ? "bg-accent" : "bg-black/60"}`}
            >
              <Text className="font-sans text-footnote font-semibold text-white">{label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setAutoScroll((on) => !on)}
            className={`rounded-full px-3 py-1.5 ${autoScroll ? "bg-highlight" : "bg-black/60"}`}
          >
            <Text className="font-sans text-footnote font-semibold text-white">
              {autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
            </Text>
          </Pressable>
          <Pressable onPress={() => router.back()} className="rounded-full bg-black/60 px-3 py-1.5">
            <Text className="font-sans text-footnote font-semibold text-white">Close</Text>
          </Pressable>
        </View>
        <FrameStatsHud resetKey={`${technique}-${autoScroll}`} />
        {technique === "skia" && snapshotMs !== null ? (
          <Text className="font-sans text-caption text-white">
            {`Snapshot ${snapshot?.width() ?? 0}×${snapshot?.height() ?? 0} px in ${snapshotMs.toFixed(0)} ms`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
