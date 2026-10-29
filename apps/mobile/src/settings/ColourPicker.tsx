import { currentLocalisation } from "@/localisation/localisation";
import { useLocalisation } from "@/localisation/localisation";
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
  inkSaveState,
  parseHexColour,
  pickColour,
  type ColourPickerPreview,
  type ColourPickerTarget,
  type CustomInkPreview,
  type Hsv,
  type InkGroup,
  type Catalogue,
} from "@wave/core";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Text, TextInput, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { makeExternalStore, type ExternalStore } from "@/lib/externalStore";
import { showAlert } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { presentOverlay } from "@/overlay/overlay";
import { useThemeColor } from "@/theme/useThemeColor";

import {
  cancelCustomInk,
  previewCustomInk,
  saveCustomInk,
  setCustomInk,
  useThemeChoice,
} from "./theme";

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

const TITLE: Record<InkGroup, (strings: Catalogue) => string> = {
  primary: (strings) => strings.settings.primaryColour,
  secondary: (strings) => strings.settings.secondaryColour,
};

/** The picker never grows wider than this, however wide the card. */
const MAX_SIZE = CELL * 32;
/** How far a screen reader's increment or decrement turns the hue. */
const HUE_STEP = 15;

/**
 * Opens the colour picker for Primary or Secondary on `initial` (`#rrggbb`).
 * The picker follows the finger; the app recolours once it rests or lifts.
 * Save adds the colour to the row's saved colours and leaves the picker
 * open; Done keeps the colour (asking first when that switches the launcher
 * icon); Cancel, Back or a tap outside puts the colours back.
 */
export const openColourPicker = (group: InkGroup, initial: string): void => {
  // The colour the app last took (at rest, on lift, typed or stepped): the samples show it.
  const applied = makeExternalStore(initial);
  const preview = previewCustomInk(group, applied.set);
  void presentOverlay<string | null>({
    label: TITLE[group](currentLocalisation().strings),
    align: "top",
    dismissed: null,
    render: (finish) => (
      <ColourPickerCard
        group={group}
        initial={initial}
        preview={preview}
        applied={applied}
        finish={finish}
      />
    ),
  }).then((hex) => (hex === null ? cancelCustomInk() : setCustomInk(group, hex, showAlert)));
};

/**
 * The card around the picker. A drag re-renders only the picker's own parts
 * (`ColourFields`: the markers and the hex); the Light and Dark samples and
 * the note follow the colour the app takes (`AppliedSamples`), and the card
 * itself only when the hex turns valid or not.
 */
function ColourPickerCard({
  group,
  initial,
  preview,
  applied,
  finish,
}: {
  group: InkGroup;
  initial: string;
  preview: ColourPickerPreview;
  applied: ExternalStore<string>;
  finish: (hex: string | null) => void;
}) {
  const { strings } = useLocalisation();
  // What Done keeps: the fields' colour, null while the hex typed isn't one.
  const entered = useRef<string | null>(initial);
  const [valid, setValid] = useState(true);
  const onColour = (hex: string | null) => {
    const was = entered.current !== null;
    entered.current = hex;
    if (was !== (hex !== null)) setValid(hex !== null);
  };

  return (
    <>
      <CatalogLine className="mb-2">{TITLE[group](strings)}</CatalogLine>
      <CardEntries>
        <ColourFields initial={initial} preview={preview} onColour={onColour} />
        <AppliedSamples group={group} applied={applied} valid={valid} />
      </CardEntries>
      <View className="flex-row justify-end" style={{ gap: CELL * 3 }}>
        <TextButton label={strings.settings.cancel} onPress={() => finish(null)} />
        <SaveButton group={group} applied={applied} valid={valid} entered={entered} />
        <TextButton
          label={strings.settings.done}
          disabled={!valid}
          onPress={() => {
            if (entered.current !== null) finish(entered.current);
          }}
        />
      </View>
      <SaveNote group={group} applied={applied} valid={valid} />
    </>
  );
}

/** What Save would do with the colour the app shows (Core's `inkSaveState`). */
const useSaveState = (group: InkGroup, applied: ExternalStore<string>, valid: boolean) => {
  const choice = useThemeChoice();
  const hex = useSyncExternalStore(applied.subscribe, applied.get);
  return valid ? inkSaveState(choice, group, hex) : "invalid";
};

/**
 * Save: adds the picker's colour to the row's saved colours without applying
 * it. Off while the colour isn't one, is saved already or the row holds four.
 */
function SaveButton({
  group,
  applied,
  valid,
  entered,
}: {
  group: InkGroup;
  applied: ExternalStore<string>;
  valid: boolean;
  entered: { readonly current: string | null };
}) {
  const { strings } = useLocalisation();
  const state = useSaveState(group, applied, valid);
  return (
    <TextButton
      label={strings.settings.save}
      accessibilityHint={strings.settings.addsThisColourToTheSavedColours}
      disabled={state !== "ready"}
      onPress={() => {
        if (entered.current !== null) saveCustomInk(group, entered.current);
      }}
    />
  );
}

/** The line under the actions when Save is off for a saved colour or a full row. */
function SaveNote({
  group,
  applied,
  valid,
}: {
  group: InkGroup;
  applied: ExternalStore<string>;
  valid: boolean;
}) {
  const { strings } = useLocalisation();
  const state = useSaveState(group, applied, valid);
  const note =
    state === "full"
      ? strings.settings.fourColoursAreSavedToSaveThis
      : state === "saved"
        ? strings.settings.thisColourIsSaved
        : null;
  if (note === null) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      className="text-right font-sans text-footnote text-secondary"
      style={{ paddingTop: CELL }}
    >
      {note}
    </Text>
  );
}

/**
 * The hue ring and shade square, and the hex field: what follows the finger.
 * Each colour shown goes to [onColour] (null for a hex that isn't one).
 */
function ColourFields({
  initial,
  preview,
  onColour,
}: {
  initial: string;
  preview: ColourPickerPreview;
  onColour: (hex: string | null) => void;
}) {
  const { strings } = useLocalisation();
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial));
  const [text, setText] = useState(initial.slice(1));
  const hex = hsvToHex(hsv);

  /** Shows `next` in the picker ([typed] when it came from the field); the app's recolour is up to `preview`. */
  const show = (next: Hsv, typed?: string) => {
    setHsv(next);
    if (typed === undefined) setText(hsvToHex(next).slice(1));
    onColour(typed ?? hsvToHex(next));
  };

  const drag = (next: Hsv) => {
    show(next);
    preview.drag(hsvToHex(next));
  };

  const step = (next: Hsv) => {
    show(next);
    preview.pick(hsvToHex(next));
  };

  const typed = (value: string) => {
    setText(value);
    const parsed = parseHexColour(value);
    if (parsed === null) onColour(null);
    else if (parsed !== hex) {
      show(hexToHsv(parsed), parsed);
      preview.pick(parsed);
    } else onColour(parsed);
  };

  return (
    <>
      <HueAndShade hsv={hsv} onDrag={drag} onLift={preview.lift} onStep={step} />
      <View className="flex-row items-center" style={{ height: grid.row }}>
        <Text className="font-sans text-title3 text-secondary">#</Text>
        <TextInput
          value={text}
          onChangeText={typed}
          maxLength={7}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel={strings.settings.hexColour}
          placeholder={strings.settings.hexPlaceholder}
          placeholderTextColor={secondary}
          selectionColor={accent}
          cursorColor={accent}
          className="flex-1 font-sans text-title3 text-foreground"
          style={{ padding: 0, marginLeft: CELL / 2 }}
        />
      </View>
    </>
  );
}

/**
 * The colour as the app took it ([applied]) in Light and Dark, and the note
 * under them: asking for a hex while the one typed isn't [valid], else
 * saying when the colour was adjusted to read on a background.
 */
function AppliedSamples({
  group,
  applied,
  valid,
}: {
  group: InkGroup;
  applied: ExternalStore<string>;
  valid: boolean;
}) {
  const { strings } = useLocalisation();
  const choice = useThemeChoice();
  const hex = useSyncExternalStore(applied.subscribe, applied.get);
  const applies = useMemo(() => customInkPreview(choice, group, hex), [choice, group, hex]);
  return (
    <>
      <View className="flex-row flex-wrap" style={{ gap: CELL, paddingBottom: CELL }}>
        <AppliesAs label={strings.settings.light} preview={applies.light} />
        <AppliesAs label={strings.settings.dark} preview={applies.dark} />
      </View>
      <Hairline />
      {/* The line is reserved so the actions don't jump when the note appears. */}
      <Text
        accessibilityLiveRegion="polite"
        className="font-sans text-footnote text-secondary"
        style={{ minHeight: CELL * 5, paddingTop: CELL / 2 }}
      >
        {!valid
          ? strings.settings.enterA3Or6digitHexColour
          : applies.light.adjusted || applies.dark.adjusted
            ? strings.settings.adjustedColour(applies.light.adjusted, applies.dark.adjusted)
            : ""}
      </Text>
    </>
  );
}

/** The colour as it will apply in one mode, on that mode's background. */
function AppliesAs({ label, preview }: { label: string; preview: CustomInkPreview }) {
  const { strings } = useLocalisation();
  return (
    <View
      accessible
      accessibilityLabel={strings.settings.colourMode(label, preview.colour)}
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

/**
 * The hue ring around the saturation and brightness square, drawn with Skia:
 * drag either (`onDrag` on each move, `onLift` when the finger leaves), or
 * step the hue with a screen reader (`onStep`).
 */
function HueAndShade({
  hsv,
  onDrag,
  onLift,
  onStep,
}: {
  hsv: Hsv;
  onDrag: (next: Hsv) => void;
  onLift: () => void;
  onStep: (next: Hsv) => void;
}) {
  const { strings } = useLocalisation();
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
        onDrag(pickColour(layout, target.current, event.x, event.y, hsv));
    },
    onUpdate: (event) => {
      if (target.current !== null)
        onDrag(pickColour(layout, target.current, event.x, event.y, hsv));
    },
    onFinalize: () => {
      target.current = null;
      onLift();
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
          accessibilityLabel={strings.settings.hue}
          accessibilityHint={strings.settings.dragTheRingForTheHueAnd}
          accessibilityValue={{ text: `${Math.round(hsv.h)} degrees` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) =>
            onStep({
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
