/**
 * The full-screen sheet the playlist pickers rise in (From YT Music, From
 * Spotify, Export to YT Music; docs/spec.md, "Importing playlists from a
 * link" and "Exporting to YT Music"): Cancel and the title at the top, Select
 * All under them, the list, and the picker's buttons at the bottom. It rises
 * as it opens and goes back down on Cancel, Back, a drag down or a button
 * that leaves with what it does next.
 */
import { settleSheet } from "@wave/core";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Modal, Text, useWindowDimensions, View } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";

/** Quick, with a little give and no wobble (as Now Playing's). */
const SPRING = { damping: 30, stiffness: 300, mass: 1 } as const;

/** Downward travel before a drag on the header takes over from a tap, in dp. */
const DRAG_SLOP = CELL * 1.5;

/** One of the picker's buttons at the bottom: pressed while enabled, the sheet goes and [afterwards] runs. */
export interface PickerSheetAction {
  readonly label: string;
  readonly disabled: boolean;
  readonly afterwards: () => void;
}

export function PickerSheetFrame({
  title,
  selectAll,
  onSelectAll,
  onClosed,
  actions,
  children,
}: {
  title: string;
  /** Select All's label (or Deselect All's); none hides it. */
  selectAll: string | null;
  onSelectAll: () => void;
  /** The sheet has gone: its host takes it down. */
  onClosed: () => void;
  /** The picker's buttons, side by side at the bottom. */
  actions: readonly PickerSheetAction[];
  children: ReactNode;
}) {
  const { strings } = useLocalisation();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const offset = useSharedValue(height);
  const start = useSharedValue(0);
  const leaving = useRef(false);
  /** [leaving] for the drag's worklets: once the sheet is closing, a drag no longer moves it. */
  const closing = useSharedValue(false);

  useEffect(() => {
    offset.set(withSpring(0, SPRING));
  }, [offset]);

  /**
   * Slides the sheet away, then runs [then] once it has gone. A drag can't
   * take the sheet back while it closes, and a spring cut short all the
   * same still closes it, so the sheet never stays part-open.
   */
  const leave = useCallback(
    (then?: () => void) => {
      if (leaving.current) return;
      leaving.current = true;
      closing.set(true);
      const gone = () => {
        onClosed();
        then?.();
      };
      offset.set(
        withSpring(height, SPRING, () => {
          scheduleOnRN(gone);
        }),
      );
    },
    [closing, height, offset, onClosed],
  );

  /** A drag down let go [at] dp below open: dismiss the sheet, doing nothing, or spring back. */
  const release = useCallback(
    (at: number, velocity: number) => {
      if (leaving.current) return;
      if (settleSheet({ from: "open", offset: at, velocity, height }) === "closed") leave();
      else offset.set(withSpring(0, { ...SPRING, velocity }));
    },
    [height, leave, offset],
  );

  const pan = usePanGesture({
    activeOffsetY: [-1_000_000, DRAG_SLOP],
    failOffsetX: [-DRAG_SLOP * 2, DRAG_SLOP * 2],
    onActivate: () => {
      "worklet";
      start.set(offset.get());
    },
    onUpdate: (event) => {
      "worklet";
      if (closing.get()) return;
      offset.set(Math.max(0, start.get() + event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(release, Math.max(0, start.get() + event.translationY), event.velocityY);
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => leave()}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View
          accessibilityViewIsModal
          className="flex-1 bg-background"
          style={[{ paddingTop: insets.top, paddingBottom: insets.bottom }, sheetStyle]}
        >
          <GestureDetector gesture={pan}>
            <View style={{ paddingHorizontal: grid.margin }}>
              <View className="items-center" style={{ paddingVertical: CELL }}>
                <View className="rounded-full bg-fill" style={{ width: CELL * 5, height: 5 }} />
              </View>
              <View className="flex-row items-center justify-between">
                <TextButton label={strings.imports.cancel} onPress={() => leave()} />
                <Text
                  accessibilityRole="header"
                  className="font-sans text-body font-medium text-foreground"
                >
                  {title}
                </Text>
                {/* Balances Cancel, so the title sits in the middle. */}
                <View style={{ width: CELL * 7 }} />
              </View>
              {selectAll !== null && (
                <View className="flex-row justify-end">
                  <TextButton label={selectAll} onPress={onSelectAll} />
                </View>
              )}
            </View>
          </GestureDetector>
          <Hairline />

          <View className="flex-1">{children}</View>

          <Hairline />
          <View
            className="flex-row items-center justify-center"
            style={{ paddingVertical: CELL, paddingHorizontal: grid.margin, gap: CELL * 4 }}
          >
            {actions.map(({ label, disabled, afterwards }) => (
              <TextButton
                key={label}
                label={label}
                disabled={disabled}
                onPress={() => {
                  if (!disabled) leave(afterwards);
                }}
              />
            ))}
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
