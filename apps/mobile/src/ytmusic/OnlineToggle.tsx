import { IconStack2, IconWorld } from "@tabler/icons-react-native";
import type { OnlineToggleForm, YtPick } from "@wave/core";
import { useMemo, type ComponentType } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";

import { CELL, widthOf } from "@/catalog/grid";
import type { LineToggle } from "@/catalog/PlayShuffle";
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

const SEGMENTS: readonly {
  readonly pick: YtPick;
  readonly label: string;
  readonly icon: ComponentType<IconProps>;
  readonly hint: string;
}[] = [
  {
    pick: "library",
    label: "Library",
    icon: IconStack2,
    hint: "Shows only what's in your library",
  },
  {
    pick: "online",
    label: "Online",
    icon: IconWorld,
    hint: "Adds what YouTube Music has",
  },
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
  return (
    // The group is as tall as the segments' targets, as Android delivers no touch outside a
    // parent's bounds; its negative margin keeps the row's layout at the drawn pill's height.
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Search online"
      className="flex-row items-center"
      style={{ height: TARGET, marginVertical: -SLOP, paddingHorizontal: INSET }}
    >
      <View
        className="absolute left-0 right-0 bg-fill"
        style={{ top: SLOP, bottom: SLOP, borderRadius: RADIUS }}
      />
      {SEGMENTS.map((segment) => (
        <Segment
          key={segment.pick}
          {...segment}
          form={form}
          selected={segment.pick === selected}
          onPress={() => {
            if (segment.pick !== selected || segment.pick === "online") onPick(segment.pick);
          }}
          onLongPress={onLongPress}
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
}: {
  label: string;
  icon: ComponentType<IconProps>;
  hint: string;
  form: OnlineToggleForm;
  selected: boolean;
  onPress: () => void;
  onLongPress: (() => void) | undefined;
}) {
  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={
        onLongPress === undefined ? hint : `${hint}. Long press to choose when to search online`
      }
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="selection"
      depth={0.1}
      className="justify-center"
      style={{ height: TARGET }}
    >
      <View
        className={`flex-row items-center justify-center${selected ? " bg-accent" : ""}`}
        style={{
          height: HEIGHT - INSET * 2,
          borderRadius: SEGMENT_RADIUS,
          paddingHorizontal: form === "labelled" ? CELL * 1.5 : CELL * 1.25,
          gap: CELL * 0.75,
        }}
      >
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
