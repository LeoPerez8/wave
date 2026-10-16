import { IconMenu2, IconMinus, IconPlus } from "@tabler/icons-react-native";
import { reorderShift, reorderTarget } from "@wave/core";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ScrollView, Text, View, type AccessibilityActionEvent } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

const ROW = grid.row;
/** A 48dp target for each of a row's buttons. */
const BUTTON = CELL * 6;

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** A change made in an arrangement editor (Core's `HomeArrangementEdit`, `TabBarEdit`). */
export type ArrangementEdit<Id> =
  | { readonly remove: Id }
  | { readonly add: Id }
  /** An item dragged from one place among those shown to another (0-based). */
  | { readonly move: { readonly from: number; readonly to: number } };

/** A row's button: add or remove the item. */
function RowButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      haptic="selection"
      depth={0.1}
      className="items-center justify-center"
      style={{ width: BUTTON, height: BUTTON, opacity: disabled ? 0.4 : 1 }}
    >
      <Icon size={20} color={disabled ? secondary : accent} strokeWidth={1.75} />
    </Press>
  );
}

function RowLabel({ title }: { title: string }) {
  return (
    <Text numberOfLines={1} className="flex-1 font-sans text-body text-foreground">
      {title}
    </Text>
  );
}

/**
 * A row the owner can't drag, above or below those they can: Home on the tab
 * bar (nothing to press), or Search, whose pill stays at the end (a button
 * takes it off when [onRemove] is given).
 */
export function FixedRow({
  title,
  place,
  onRemove,
  divider,
}: {
  title: string;
  /** Where the item sits, for the remove button's label: "Home", "the tab bar". */
  place: string;
  onRemove?: () => void;
  divider: boolean;
}) {
  return (
    <View style={{ height: ROW }}>
      <View className="flex-1 flex-row items-center">
        <RowLabel title={title} />
        {onRemove !== undefined && (
          <View style={{ marginRight: -CELL * 1.5 }}>
            <RowButton
              icon={IconMinus}
              label={`Remove ${title} from ${place}`}
              onPress={onRemove}
            />
          </View>
        )}
      </View>
      {divider && <Hairline />}
    </View>
  );
}

/** The drag going on among the shown items: from where, to where it would land. */
type Drag = { readonly from: number; readonly to: number };

type ShownRowProps<Id> = {
  id: Id;
  title: string;
  place: string;
  index: number;
  count: number;
  /** Draw a hairline under the last row too (a fixed row follows). */
  divideLast: boolean;
  drag: Drag | null;
  /** The dragged row's travel since it was picked up. */
  travel: SharedValue<number>;
  edit: (edit: ArrangementEdit<Id>) => void;
  pickUp: (index: number) => void;
  dragTo: (travel: number) => void;
  drop: (canceled: boolean) => void;
};

/**
 * An item shown: its title, a button that takes it off, and a handle to drag
 * it up or down. Screen readers get Move up / Move down / Remove.
 */
function ShownRow<Id>({
  id,
  title,
  place,
  index,
  count,
  divideLast,
  drag,
  travel,
  edit,
  pickUp,
  dragTo,
  drop,
}: ShownRowProps<Id>) {
  const secondary = useThemeColor("secondary");
  const fill = useThemeColor("fill");
  const dragged = drag?.from === index;
  const shift = drag === null || dragged ? 0 : reorderShift({ index, ...drag }) * ROW;

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: dragged ? travel.get() : shift }],
  }));

  const handle = usePanGesture(
    useMemo(
      () => ({
        minDistance: 0,
        onActivate: () => {
          "worklet";
          travel.set(0);
          scheduleOnRN(pickUp, index);
        },
        onUpdate: (event: { translationY: number }) => {
          "worklet";
          travel.set(event.translationY);
          scheduleOnRN(dragTo, event.translationY);
        },
        onDeactivate: (event: { canceled: boolean }) => {
          "worklet";
          scheduleOnRN(drop, event.canceled);
        },
      }),
      [travel, pickUp, dragTo, drop, index],
    ),
  );

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const action = event.nativeEvent.actionName;
    if (action === "moveUp") edit({ move: { from: index, to: index - 1 } });
    else if (action === "moveDown") edit({ move: { from: index, to: index + 1 } });
    else if (action === "remove") edit({ remove: id });
  };

  return (
    <Animated.View
      style={[
        { height: ROW, zIndex: dragged ? 1 : 0, backgroundColor: dragged ? fill : "transparent" },
        style,
      ]}
    >
      <View
        accessible
        accessibilityLabel={title}
        accessibilityActions={[
          ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
          ...(index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
          { name: "remove", label: `Remove from ${place}` },
        ]}
        onAccessibilityAction={onAccessibilityAction}
        className="flex-1 flex-row items-center"
      >
        <RowLabel title={title} />
        <RowButton
          icon={IconMinus}
          label={`Remove ${title} from ${place}`}
          onPress={() => edit({ remove: id })}
        />
        <GestureDetector gesture={handle}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="items-center justify-center"
            style={{ width: BUTTON, height: BUTTON, marginRight: -CELL * 1.5 }}
          >
            <IconMenu2 size={20} color={secondary} strokeWidth={1.5} />
          </View>
        </GestureDetector>
      </View>
      {!dragged && (divideLast || index < count - 1) && <Hairline />}
    </Animated.View>
  );
}

/** An item not shown, with a button that adds it (off while nothing more fits). */
function HiddenRow<Id>({
  id,
  title,
  place,
  divider,
  canAdd,
  edit,
}: {
  id: Id;
  title: string;
  place: string;
  divider: boolean;
  canAdd: boolean;
  edit: (edit: ArrangementEdit<Id>) => void;
}) {
  return (
    <View style={{ height: ROW }}>
      <View className="flex-1 flex-row items-center">
        <RowLabel title={title} />
        <View style={{ marginRight: -CELL * 1.5 }}>
          <RowButton
            icon={IconPlus}
            label={`Add ${title} to ${place}`}
            disabled={!canAdd}
            onPress={() => edit({ add: id })}
          />
        </View>
      </View>
      {divider && <Hairline />}
    </View>
  );
}

export type ArrangementEditorProps<Id extends string> = {
  /** The items shown that can be dragged, in order. */
  shown: readonly Id[];
  /** The items not shown, in the order they're offered. */
  hidden: readonly Id[];
  title: (id: Id) => string;
  /** Where the items show, for buttons' labels: "Home", "the tab bar". */
  place: string;
  /** The heading over the items not shown, e.g. "Not on Home". */
  hiddenHeading: string;
  edit: (edit: ArrangementEdit<Id>) => void;
  /** Whether another item fits; while it doesn't, the add buttons are off. */
  canAdd?: boolean;
  /** A fixed row above the shown items (`FixedRow`). */
  first?: ReactNode;
  /** A fixed row below them (`FixedRow`). */
  last?: ReactNode;
  /** A line under the lists, e.g. what can't be changed. */
  note?: string;
  onDone: () => void;
};

/**
 * An editor for an ordered set of items (Home's sections, the tab bar's
 * tabs), in a card: the items shown (drag a handle to reorder, a button
 * removes one), then those not shown (a button adds one). The caller keeps
 * the arrangement and applies each `edit`; Done hands it back.
 */
export function ArrangementEditor<Id extends string>({
  shown,
  hidden,
  title,
  place,
  hiddenHeading,
  edit,
  canAdd = true,
  first,
  last,
  note,
  onDone,
}: ArrangementEditorProps<Id>) {
  const [drag, setDrag] = useState<Drag | null>(null);
  // The drag as the gesture's callbacks last left it, ahead of a render.
  const dragNow = useRef<Drag | null>(null);
  const travel = useSharedValue(0);
  const count = shown.length;
  const empty = count === 0 && first === undefined && last === undefined;

  const follow = useCallback((next: Drag | null) => {
    dragNow.current = next;
    setDrag(next);
  }, []);
  const pickUp = useCallback(
    (from: number) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      follow({ from, to: from });
    },
    [follow],
  );
  const dragTo = useCallback(
    (distance: number) => {
      const current = dragNow.current;
      if (current === null) return;
      const to = reorderTarget({ from: current.from, distance, rowHeight: ROW, count });
      if (to !== current.to) follow({ ...current, to });
    },
    [count, follow],
  );
  const drop = useCallback(
    (canceled: boolean) => {
      const current = dragNow.current;
      if (current !== null && !canceled && current.to !== current.from) {
        edit({ move: { from: current.from, to: current.to } });
      }
      follow(null);
      travel.set(0);
    },
    [edit, follow, travel],
  );

  return (
    <>
      <View style={{ flexShrink: 1 }}>
        <ScrollView bounces={false} overScrollMode="never" scrollEnabled={drag === null}>
          {first}
          {shown.map((id, index) => (
            <ShownRow
              key={id}
              id={id}
              title={title(id)}
              place={place}
              index={index}
              count={count}
              divideLast={last !== undefined}
              drag={drag}
              travel={travel}
              edit={edit}
              pickUp={pickUp}
              dragTo={dragTo}
              drop={drop}
            />
          ))}
          {last}
          {hidden.length > 0 && (
            <View
              style={{ marginTop: empty ? 0 : CELL * 3, paddingBottom: CELL / 2 }}
              accessibilityRole="header"
            >
              <CatalogLine>{hiddenHeading}</CatalogLine>
            </View>
          )}
          {hidden.map((id, index) => (
            <HiddenRow
              key={id}
              id={id}
              title={title(id)}
              place={place}
              divider={index < hidden.length - 1}
              canAdd={canAdd}
              edit={edit}
            />
          ))}
          {note !== undefined && (
            <Text className="mt-2 font-sans text-footnote text-secondary">{note}</Text>
          )}
        </ScrollView>
      </View>
      <View className="flex-row justify-end" style={{ paddingTop: CELL }}>
        <TextButton label="Done" onPress={onDone} />
      </View>
    </>
  );
}
