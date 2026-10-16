import { IconMenu2, IconMinus, IconPlus } from "@tabler/icons-react-native";
import {
  editHomeArrangement,
  hiddenHomeSections,
  homeSectionNote,
  homeSectionTitle,
  reorderShift,
  reorderTarget,
  type HomeArrangement,
  type HomeArrangementEdit,
  type HomeSectionId,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useRef, useState, type ComponentType } from "react";
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
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { useThemeColor } from "@/theme/useThemeColor";

const ROW = grid.row;
/** A 48dp target for each of a row's buttons. */
const BUTTON = CELL * 6;

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** A row's button: add or remove the section. */
function RowButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
}) {
  const accent = useThemeColor("accent");
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      haptic="selection"
      depth={0.1}
      className="items-center justify-center"
      style={{ width: BUTTON, height: BUTTON }}
    >
      <Icon size={20} color={accent} strokeWidth={1.75} />
    </Press>
  );
}

/** A section's title, and under it what it needs that's off ("Needs YT Music"). */
function RowLabel({ id }: { id: HomeSectionId }) {
  const note = homeSectionNote(id, { ytMusic: useYtMusicEnabled() });
  return (
    <View className="flex-1">
      <Text numberOfLines={1} className="font-sans text-body text-foreground">
        {homeSectionTitle(id)}
      </Text>
      {note !== null && (
        <Text numberOfLines={1} className="font-sans text-footnote text-secondary">
          {note}
        </Text>
      )}
    </View>
  );
}

/** The drag going on among the shown sections: from where, to where it would land. */
type Drag = { readonly from: number; readonly to: number };

type ShownRowProps = {
  id: HomeSectionId;
  index: number;
  count: number;
  drag: Drag | null;
  /** The dragged row's travel since it was picked up. */
  travel: SharedValue<number>;
  edit: (edit: HomeArrangementEdit) => void;
  pickUp: (index: number) => void;
  dragTo: (travel: number) => void;
  drop: (canceled: boolean) => void;
};

/**
 * A section Home shows: its title, a button that takes it off Home, and a
 * handle to drag it up or down. Screen readers get Move up / Move down / Remove.
 */
function ShownRow({ id, index, count, drag, travel, edit, pickUp, dragTo, drop }: ShownRowProps) {
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

  const title = homeSectionTitle(id);
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
          { name: "remove", label: "Remove from Home" },
        ]}
        onAccessibilityAction={onAccessibilityAction}
        className="flex-1 flex-row items-center"
      >
        <RowLabel id={id} />
        <RowButton
          icon={IconMinus}
          label={`Remove ${title} from Home`}
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
      {!dragged && index < count - 1 && <Hairline />}
    </Animated.View>
  );
}

/** A section Home doesn't show, with a button that adds it at the bottom. */
function HiddenRow({
  id,
  divider,
  edit,
}: {
  id: HomeSectionId;
  divider: boolean;
  edit: (edit: HomeArrangementEdit) => void;
}) {
  return (
    <View style={{ height: ROW }}>
      <View className="flex-1 flex-row items-center">
        <RowLabel id={id} />
        <View style={{ marginRight: -CELL * 1.5 }}>
          <RowButton
            icon={IconPlus}
            label={`Add ${homeSectionTitle(id)} to Home`}
            onPress={() => edit({ add: id })}
          />
        </View>
      </View>
      {divider && <Hairline />}
    </View>
  );
}

/**
 * Home's editor, opened by a long press on Home's title: the sections Home
 * shows (drag a handle to reorder, a button removes one), then those it
 * doesn't (a button adds one at the bottom). Done hands the arrangement to
 * [done]; until then Home stays as it was.
 */
export function HomeEditor({
  initial,
  done,
}: {
  initial: HomeArrangement;
  done: (arrangement: HomeArrangement) => void;
}) {
  const [arrangement, setArrangement] = useState(initial);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The drag as the gesture's callbacks last left it, ahead of a render.
  const dragNow = useRef<Drag | null>(null);
  const travel = useSharedValue(0);
  const hidden = hiddenHomeSections(arrangement);
  const count = arrangement.length;

  const edit = useCallback(
    (change: HomeArrangementEdit) =>
      setArrangement((current) => editHomeArrangement(current, change)),
    [],
  );
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
          {arrangement.map((id, index) => (
            <ShownRow
              key={id}
              id={id}
              index={index}
              count={count}
              drag={drag}
              travel={travel}
              edit={edit}
              pickUp={pickUp}
              dragTo={dragTo}
              drop={drop}
            />
          ))}
          {hidden.length > 0 && (
            <View
              style={{ marginTop: count === 0 ? 0 : CELL * 3, paddingBottom: CELL / 2 }}
              accessibilityRole="header"
            >
              <CatalogLine>Not on Home</CatalogLine>
            </View>
          )}
          {hidden.map((id, index) => (
            <HiddenRow key={id} id={id} divider={index < hidden.length - 1} edit={edit} />
          ))}
        </ScrollView>
      </View>
      <View className="flex-row justify-end" style={{ paddingTop: CELL }}>
        <TextButton label="Done" onPress={() => done(arrangement)} />
      </View>
    </>
  );
}
