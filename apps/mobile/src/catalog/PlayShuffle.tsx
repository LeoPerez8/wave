import { IconPlayerPlay } from "@tabler/icons-react-native";
import { listActionsForms, type ListActionsRoom, type YtPick } from "@wave/core";
import { useState, type ComponentType, type ReactNode } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";

import { IconButton } from "@/components/IconButton";
import { useShuffleControl } from "@/nowPlaying/ShuffleMenu";
import { useThemeColor } from "@/theme/useThemeColor";
import { OnlineToggle, OnlineToggleFaces } from "@/ytmusic/OnlineToggle";

import { CELL, widthOf } from "./grid";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** The space between two of a list's actions. */
const GAP = CELL * 4;

/** A list action's face: its teal line icon and its label. */
function ActionFace({ icon: Icon, label }: { icon: ComponentType<IconProps>; label: string }) {
  const accent = useThemeColor("accent");
  return (
    <>
      <Icon size={24} color={accent} strokeWidth={1.5} />
      <Text
        numberOfLines={1}
        className="font-sans text-body font-medium text-accent"
        style={{ flexShrink: 1 }}
      >
        {label}
      </Text>
    </>
  );
}

/** One of a list's actions under its head: a teal line icon and its label, no container. */
export function ListAction({
  icon,
  label,
  onPress,
  onLongPress,
  accessibilityLabel = label,
  accessibilityHint,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  return (
    <IconButton
      icon={icon}
      label={accessibilityLabel}
      caption={label}
      layout="horizontal"
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="impact"
      depth={0.04}
      style={{
        width: undefined,
        height: undefined,
        minHeight: 48,
        gap: CELL,
        flexShrink: 1,
        justifyContent: "flex-start",
      }}
      captionProps={{
        numberOfLines: 1,
        className: "font-sans text-body font-medium",
        style: { flexShrink: 1 },
      }}
    />
  );
}

/** The last of a list's actions (a playlist's or an album's download), after Shuffle. */
export interface LastListAction {
  readonly icon: ComponentType<IconProps>;
  /** What it says now ("Download", "Cancel", "Retry Failed"). */
  readonly label: string;
  /** Every label it can say, measured ahead so a change of state settles at once. */
  readonly labels: readonly string[];
  /** The full name ("Download Playlist", "Retry Failed"…), heard in either form. */
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}

type Props = {
  onPlay: () => void;
  onShuffle: () => void;
  /** An action after Shuffle (a YT Music album's or a playlist's Download). */
  last?: LastListAction | null;
  /** What ends the line (a playlist's actions button); a last action's icon alone sits before it. */
  menu?: ReactNode;
  /** The Library | Online toggle ending the line (an album's or artist's page, YT Music on). */
  toggle?: LineToggle | null;
};

/** The Library | Online toggle as a list's line carries it. */
export interface LineToggle {
  readonly selected: YtPick;
  readonly onPick: (pick: YtPick) => void;
  readonly onLongPress?: () => void;
}

/**
 * Play and Shuffle for a list: two teal line-icon actions, no containers, on
 * one line. An action after them keeps its label when it fits beside them
 * and shows its icon alone at the end of the line when it doesn't; a Library
 * | Online toggle ending the line shows its icons alone first (Core's
 * `listActionsForms`).
 */
export function PlayShuffle({ onPlay, onShuffle, last, menu, toggle }: Props) {
  const shuffle = useShuffleControl();
  return (
    <View className="flex-row items-center" style={{ flexGrow: 1, flexShrink: 1 }}>
      {last == null && toggle == null ? (
        <View className="flex-1 flex-row items-center" style={{ columnGap: GAP }}>
          <ListAction icon={IconPlayerPlay} label="Play" onPress={onPlay} />
          <ListAction {...shuffle} onPress={onShuffle} />
        </View>
      ) : (
        <LineWithLast
          onPlay={onPlay}
          onShuffle={onShuffle}
          last={last ?? null}
          toggle={toggle ?? null}
          shuffle={shuffle}
          endsLine={menu === undefined}
        />
      )}
      {menu}
    </View>
  );
}

type Measured = Omit<ListActionsRoom, "gap" | "toggle"> & {
  readonly toggle: { readonly labelled: number | undefined; readonly icons: number | undefined };
};

const NOTHING_MEASURED: Measured = {
  line: undefined,
  before: [undefined, undefined],
  last: {},
  toggle: { labelled: undefined, icons: undefined },
};

const NO_LABELS: readonly string[] = [];

function LineWithLast({
  onPlay,
  onShuffle,
  last,
  toggle,
  shuffle,
  endsLine,
}: {
  onPlay: () => void;
  onShuffle: () => void;
  last: LastListAction | null;
  toggle: LineToggle | null;
  shuffle: ReturnType<typeof useShuffleControl>;
  /** Nothing after it on the line: its icon alone sits on the right margin. */
  endsLine: boolean;
}) {
  const [measured, setMeasured] = useState<Measured>(NOTHING_MEASURED);
  // Each width is kept only when it changed, so layout settles.
  const update = (change: (current: Measured) => Measured | null) =>
    setMeasured((current) => change(current) ?? current);
  const measureLine = (event: LayoutChangeEvent) => {
    const width = widthOf(event);
    update((current) => (current.line === width ? null : { ...current, line: width }));
  };
  const measureBefore = (index: number) => (event: LayoutChangeEvent) => {
    const width = widthOf(event);
    update((current) =>
      current.before[index] === width
        ? null
        : { ...current, before: current.before.map((old, at) => (at === index ? width : old)) },
    );
  };
  const measureLast = (label: string) => (event: LayoutChangeEvent) => {
    const width = widthOf(event);
    update((current) =>
      current.last[label] === width
        ? null
        : { ...current, last: { ...current.last, [label]: width } },
    );
  };
  const measureToggle = (form: "labelled" | "icons") => (width: number) =>
    update((current) =>
      current.toggle[form] === width
        ? null
        : { ...current, toggle: { ...current.toggle, [form]: width } },
    );
  const forms = listActionsForms(
    { ...measured, gap: GAP, toggle: toggle === null ? undefined : measured.toggle },
    last?.label ?? null,
  );
  const form = forms.last;
  const labels =
    last === null
      ? NO_LABELS
      : last.labels.includes(last.label)
        ? last.labels
        : [...last.labels, last.label];

  return (
    <View
      className="flex-1 flex-row items-center"
      style={{ columnGap: GAP }}
      onLayout={measureLine}
    >
      <ListAction icon={IconPlayerPlay} label="Play" onPress={onPlay} />
      <ListAction {...shuffle} onPress={onShuffle} />
      {last !== null && form === "labelled" && (
        <ListAction
          icon={last.icon}
          label={last.label}
          accessibilityLabel={last.accessibilityLabel}
          onPress={last.onPress}
        />
      )}
      {last !== null && form === "icon" && (
        <IconButton
          icon={last.icon}
          label={last.accessibilityLabel}
          onPress={last.onPress}
          haptic="impact"
          // Ending the line, its glyph sits on the right margin, as a playlist's ⋯ does;
          // before a toggle, it sits beside it.
          className={`items-center justify-center${toggle === null ? " ml-auto" : ""}${
            endsLine && toggle === null ? " -mr-3" : ""
          }`}
          style={{ width: 48, height: 48 }}
        />
      )}
      {toggle !== null && forms.toggle !== null && (
        <View className="ml-auto">
          <OnlineToggle
            selected={toggle.selected}
            onPick={toggle.onPick}
            onLongPress={toggle.onLongPress}
            form={forms.toggle}
          />
        </View>
      )}
      {/* Every action measured with its label, unseen, whatever the line shows. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="absolute top-0 left-0 items-start opacity-0"
      >
        <Face icon={IconPlayerPlay} label="Play" onLayout={measureBefore(0)} />
        <Face icon={shuffle.icon} label={shuffle.label} onLayout={measureBefore(1)} />
        {last !== null &&
          labels.map((label) => (
            <Face key={label} icon={last.icon} label={label} onLayout={measureLast(label)} />
          ))}
        {toggle !== null && (
          <OnlineToggleFaces
            onLabelled={measureToggle("labelled")}
            onIcons={measureToggle("icons")}
          />
        )}
      </View>
    </View>
  );
}

/** A list action's face laid out as `ListAction` lays it out, to be measured. */
function Face({
  icon,
  label,
  onLayout,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  return (
    <View
      className="flex-row items-center"
      style={{ minHeight: 48, gap: CELL }}
      onLayout={onLayout}
    >
      <ActionFace icon={icon} label={label} />
    </View>
  );
}
