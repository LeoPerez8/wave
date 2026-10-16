import {
  Canvas,
  Circle,
  LinearGradient,
  RoundedRect,
  SweepGradient,
  vec,
} from "@shopify/react-native-skia";
import {
  colourPickerLayout,
  colourPickerMarkers,
  colourPickerTarget,
  customInkPreview,
  hexToHsv,
  hsvToHex,
  parseHexColour,
  pickColour,
  type ColourPickerTarget,
  type CustomInkPreview,
  type Hsv,
  type InkGroup,
} from "@wave/core";
import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { confirmAction } from "@/overlay/alert";
import { presentOverlay } from "@/overlay/overlay";
import { useThemeColor } from "@/theme/useThemeColor";

import { cancelCustomInk, previewCustomInk, setCustomInk, useThemeChoice } from "./theme";

/** The hue wheel's colours, red round to red, for Skia's sweep gradient (clockwise from 3 o'clock). */
export const HUE_STOPS = [
  "#ff0000",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0000ff",
  "#ff00ff",
  "#ff0000",
];

const TITLE: Record<InkGroup, string> = {
  primary: "Primary colour",
  secondary: "Secondary colour",
};

/** The picker never grows wider than this, however wide the card. */
const MAX_SIZE = CELL * 32;
/** How far a screen reader's increment or decrement turns the hue. */
const HUE_STEP = 15;

/**
 * Opens the colour picker for Primary or Secondary on `initial` (`#rrggbb`).
 * The app recolours while the owner picks; Done keeps the colour (asking
 * first when that switches the launcher icon), Cancel, Back or a tap outside
 * puts the colours back.
 */
export const openColourPicker = (group: InkGroup, initial: string): void => {
  void presentOverlay<string | null>({
    label: TITLE[group],
    align: "top",
    dismissed: null,
    render: (finish) => <ColourPickerCard group={group} initial={initial} finish={finish} />,
  }).then((hex) => (hex === null ? cancelCustomInk() : setCustomInk(group, hex, confirmAction)));
};

function ColourPickerCard({
  group,
  initial,
  finish,
}: {
  group: InkGroup;
  initial: string;
  finish: (hex: string | null) => void;
}) {
  const choice = useThemeChoice();
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial));
  const [text, setText] = useState(initial.slice(1));
  const hex = hsvToHex(hsv);
  const preview = customInkPreview(choice, group, hex);

  const pick = (next: Hsv, fromText = false) => {
    setHsv(next);
    if (!fromText) setText(hsvToHex(next).slice(1));
    previewCustomInk(group, hsvToHex(next));
  };

  const typed = (value: string) => {
    setText(value);
    const parsed = parseHexColour(value);
    if (parsed !== null && parsed !== hex) pick(hexToHsv(parsed), true);
  };

  return (
    <>
      <CatalogLine className="mb-2">{TITLE[group]}</CatalogLine>
      <HueAndShade hsv={hsv} onPick={pick} />
      <View className="flex-row items-center" style={{ height: grid.row }}>
        <Text className="font-sans text-title3 text-secondary">#</Text>
        <TextInput
          value={text}
          onChangeText={typed}
          onBlur={() => setText(hex.slice(1))}
          onSubmitEditing={() => setText(hex.slice(1))}
          maxLength={7}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel="Hex colour"
          placeholder="rrggbb"
          placeholderTextColor={secondary}
          selectionColor={accent}
          cursorColor={accent}
          className="flex-1 font-sans text-title3 text-foreground"
          style={{ padding: 0, marginLeft: CELL / 2 }}
        />
        <View className="flex-row" style={{ gap: CELL }}>
          <AppliesAs label="Light" preview={preview.light} />
          <AppliesAs label="Dark" preview={preview.dark} />
        </View>
      </View>
      <Hairline />
      {/* The line is reserved so the actions don't jump when the note appears. */}
      <Text
        accessibilityLiveRegion="polite"
        className="font-sans text-footnote text-secondary"
        style={{ minHeight: CELL * 5, paddingTop: CELL / 2 }}
      >
        {preview.light.adjusted || preview.dark.adjusted
          ? `Adjusted to read on your ${
              preview.light.adjusted && preview.dark.adjusted
                ? "backgrounds"
                : `${preview.light.adjusted ? "light" : "dark"} background`
            }, as shown.`
          : ""}
      </Text>
      <View className="flex-row justify-end" style={{ gap: CELL * 3 }}>
        <TextButton label="Cancel" onPress={() => finish(null)} />
        <TextButton label="Done" onPress={() => finish(hex)} />
      </View>
    </>
  );
}

/** The colour as it will apply in one mode, on that mode's background. */
function AppliesAs({ label, preview }: { label: string; preview: CustomInkPreview }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label} mode: ${preview.colour}`}
      className="flex-row items-center rounded-full border border-separator"
      style={{
        backgroundColor: preview.ground,
        paddingHorizontal: CELL,
        height: CELL * 4,
        gap: CELL / 2,
      }}
    >
      <View
        className="rounded-full"
        style={{ width: CELL * 1.5, height: CELL * 1.5, backgroundColor: preview.colour }}
      />
      <Text className="font-sans text-footnote font-medium" style={{ color: preview.colour }}>
        {label}
      </Text>
    </View>
  );
}

/** The hue ring around the saturation and brightness square, drawn with Skia; drag either. */
function HueAndShade({ hsv, onPick }: { hsv: Hsv; onPick: (next: Hsv) => void }) {
  const [size, setSize] = useState(0);
  const layout = colourPickerLayout(size);
  // A drag keeps to the part it started on, even when it strays off it.
  const target = useRef<ColourPickerTarget | null>(null);

  const pan = usePanGesture({
    runOnJS: true,
    minDistance: 0,
    onActivate: (event) => {
      target.current = colourPickerTarget(layout, event.x, event.y);
      if (target.current !== null)
        onPick(pickColour(layout, target.current, event.x, event.y, hsv));
    },
    onUpdate: (event) => {
      if (target.current !== null)
        onPick(pickColour(layout, target.current, event.x, event.y, hsv));
    },
    onFinalize: () => {
      target.current = null;
    },
  });

  const { centre, ringRadius, ringWidth, square } = layout;
  const markers = colourPickerMarkers(layout, hsv);
  const hue = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const marker = ringWidth / 2;

  return (
    <View
      onLayout={(event) => setSize(Math.min(MAX_SIZE, event.nativeEvent.layout.width))}
      className="items-center"
      style={{ paddingVertical: CELL }}
    >
      <GestureDetector gesture={pan}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Hue"
          accessibilityHint="Drag the ring for the hue and the square for the shade, or type a hex colour"
          accessibilityValue={{ text: `${Math.round(hsv.h)} degrees` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) =>
            onPick({
              ...hsv,
              h:
                (hsv.h +
                  (event.nativeEvent.actionName === "increment" ? HUE_STEP : -HUE_STEP) +
                  360) %
                360,
            })
          }
          style={{ width: size, height: size }}
        >
          {size > 0 ? (
            <Canvas style={{ width: size, height: size }}>
              <Circle cx={centre} cy={centre} r={ringRadius} style="stroke" strokeWidth={ringWidth}>
                <SweepGradient c={vec(centre, centre)} colors={HUE_STOPS} />
              </Circle>
              <RoundedRect
                x={square.left}
                y={square.top}
                width={square.side}
                height={square.side}
                r={CELL}
                color={hue}
              />
              <RoundedRect
                x={square.left}
                y={square.top}
                width={square.side}
                height={square.side}
                r={CELL}
              >
                <LinearGradient
                  start={vec(square.left, 0)}
                  end={vec(square.left + square.side, 0)}
                  colors={["#ffffff", "#ffffff00"]}
                />
              </RoundedRect>
              <RoundedRect
                x={square.left}
                y={square.top}
                width={square.side}
                height={square.side}
                r={CELL}
              >
                <LinearGradient
                  start={vec(0, square.top)}
                  end={vec(0, square.top + square.side)}
                  colors={["#00000000", "#000000"]}
                />
              </RoundedRect>
              <Marker x={markers.ring.x} y={markers.ring.y} r={marker} colour={hue} />
              <Marker x={markers.square.x} y={markers.square.y} r={marker} colour={hsvToHex(hsv)} />
            </Canvas>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

/** A picker handle: the colour it points at in a white ring, edged dark so it shows on white too. */
function Marker({ x, y, r, colour }: { x: number; y: number; r: number; colour: string }) {
  return (
    <>
      <Circle cx={x} cy={y} r={r + 1} color="#00000059" />
      <Circle cx={x} cy={y} r={r} color="#ffffff" />
      <Circle cx={x} cy={y} r={r - 3} color={colour} />
    </>
  );
}
