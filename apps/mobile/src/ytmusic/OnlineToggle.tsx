import { IconStack2, IconWorld } from "@tabler/icons-react-native";
import type { Catalogue, OnlineToggleForm, YtPick } from "@wave/core";
import { useMemo, useRef, type ComponentRef, type ComponentType, type RefObject } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";

import { CELL, widthOf } from "@/catalog/grid";
import type { LineToggle } from "@/catalog/PlayShuffle";
import { useLocalisation } from "@/localisation/localisation";
import { Press } from "@/motion/Press";
import { openSearchOnlineChoices } from "@/settings/searchOnline";
import { useThemeColor } from "@/theme/useThemeColor";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** The drawn pill's height. */
const HEIGHT = CELL * 4;
/** Each segment's target: 48dp tall, reaching past the drawn pill above and below. */
const TARGET = CELL * 6;
/** How far the targets reach past the pill on each side; the row lays the toggle out at [HEIGHT]. */
const SLOP = (TARGET - HEIGHT) / 2;
/** The inset of the selected segment's pill inside the track. */
const INSET = 2;
const RADIUS = HEIGHT / 2;
const SEGMENT_RADIUS = RADIUS - INSET;
const GLYPH = 18;

const segments = ({
  library,
}: Catalogue): readonly {
  readonly pick: YtPick;
  readonly label: string;
  readonly icon: ComponentType<IconProps>;
  readonly hint: string;
}[] => [
  { pick: "library", label: library.library, icon: IconStack2, hint: library.libraryHint },
  { pick: "online", label: library.online, icon: IconWorld, hint: library.onlineHint },
];

type Props = {
  selected: YtPick;
  onPick: (pick: YtPick) => void;
  /** Labelled, or icons alone where the row is tight (labels stay for screen readers). */
  form: OnlineToggleForm;
  /** A long press on either segment: the Search online card (`openSearchOnlineChoices`). */
  onLongPress?: () => void;
};

/**
 * The Library | Online toggle (Core's `onlineToggle.ts`): two segments on a
 * fill-tone pill, the selected one a teal pill with on-accent ink, the other
 * graphite. Library is the Library's own content; Online (the globe) merges
 * in what YouTube Music has. Where the row is tight it shows the icons alone
 * (`listActionsForms`), each still named for TalkBack.
 */
export function OnlineToggle({ selected, onPick, form, onLongPress }: Props) {
  // The drawn pill: a long press on either segment highlights all of it, in its own shape,
  // and anchors the card to it (the toggle is one control).
  const pill = useRef<ComponentRef<typeof View>>(null);
  const { strings } = useLocalisation();
  return (
    // The group is as tall as the segments' targets, as Android delivers no touch outside a
    // parent's bounds; its negative margin keeps the row's layout at the drawn pill's height.
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={strings.library.searchOnline}
      className="flex-row items-center"
      style={{ height: TARGET, marginVertical: -SLOP, paddingHorizontal: INSET }}
    >
      <View
        ref={pill}
        collapsable={false}
        className="absolute left-0 right-0 bg-fill"
        style={{ top: SLOP, bottom: SLOP, borderRadius: RADIUS }}
      />
      {segments(strings).map((segment) => (
        <Segment
          key={segment.pick}
          {...segment}
          form={form}
          selected={segment.pick === selected}
          onPress={() => {
            if (segment.pick !== selected || segment.pick === "online") onPick(segment.pick);
          }}
          onLongPress={onLongPress}
          pill={pill}
        />
      ))}
    </View>
  );
}

function Segment({
  label,
  icon,
  hint,
  form,
  selected,
  onPress,
  onLongPress,
  pill,
}: {
  label: string;
  icon: ComponentType<IconProps>;
  hint: string;
  form: OnlineToggleForm;
  selected: boolean;
  onPress: () => void;
  onLongPress: (() => void) | undefined;
  /** The toggle's drawn pill, which the long press highlights. */
  pill: RefObject<ComponentRef<typeof View> | null>;
}) {
  const { strings } = useLocalisation();
  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={
        onLongPress === undefined ? hint : strings.library.longPressOnline(hint)
      }
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      highlightAs={{ view: pill, radius: RADIUS }}
      haptic="selection"
      depth={0.1}
      className="justify-center"
      style={{ height: TARGET }}
    >
      <View
        className="flex-row items-center justify-center"
        style={{
          height: HEIGHT - INSET * 2,
          paddingHorizontal: form === "labelled" ? CELL * 1.5 : CELL * 1.25,
          gap: CELL * 0.75,
        }}
      >
        {/* The teal pill stays mounted with its colour and radius from the first frame and is only
            shown or hidden. A background class a tap added drew square on Android: the segment
            was flattened away while it had no background, and the view made for it on the tap
            lost the radius. */}
        <View
          pointerEvents="none"
          className="absolute bottom-0 left-0 right-0 top-0 bg-accent"
          style={{ borderRadius: SEGMENT_RADIUS, opacity: selected ? 1 : 0 }}
        />
        <SegmentFace label={label} icon={icon} form={form} selected={selected} />
      </View>
    </Press>
  );
}

function SegmentFace({
  label,
  icon: Icon,
  form,
  selected,
}: {
  label: string;
  icon: ComponentType<IconProps>;
  form: OnlineToggleForm;
  selected: boolean;
}) {
  const ink = useThemeColor(selected ? "on-accent" : "secondary");
  return (
    <>
      <Icon size={GLYPH} color={ink} strokeWidth={1.75} />
      {form === "labelled" && (
        <Text
          numberOfLines={1}
          className={`font-sans text-subheadline font-semibold ${
            selected ? "text-on-accent" : "text-secondary"
          }`}
        >
          {label}
        </Text>
      )}
    </>
  );
}

/**
 * The toggle drawn unseen in both forms, so a row can measure it ahead
 * (`listActionsForms`): [onLabelled] and [onIcons] get its widths.
 */
export function OnlineToggleFaces({
  onLabelled,
  onIcons,
}: {
  onLabelled: (width: number) => void;
  onIcons: (width: number) => void;
}) {
  return (
    <>
      <View className="flex-row" onLayout={measure(onLabelled)}>
        <OnlineToggle selected="library" onPick={ignore} form="labelled" />
      </View>
      <View className="flex-row" onLayout={measure(onIcons)}>
        <OnlineToggle selected="library" onPick={ignore} form="icons" />
      </View>
    </>
  );
}

const ignore = () => undefined;

/** Hands a layout pass's width to [report]. */
const measure = (report: (width: number) => void) => (event: LayoutChangeEvent) =>
  report(widthOf(event));

/**
 * The toggle a list's line or the search field carries: [selected] with [onPick], its long press
 * the Search online card (`openSearchOnlineChoices`). Null while there's no toggle to show.
 */
export const useLineToggle = (
  selected: YtPick | null | undefined,
  onPick: (pick: YtPick) => void,
): LineToggle | null =>
  useMemo(
    () => (selected == null ? null : { selected, onPick, onLongPress: openSearchOnlineChoices }),
    [selected, onPick],
  );
