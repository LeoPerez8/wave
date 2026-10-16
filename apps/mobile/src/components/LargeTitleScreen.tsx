import { useScrollToTop } from "expo-router";
import { useRef, type ReactElement, type ReactNode } from "react";
import {
  ScrollView,
  type ScrollViewInstance,
  Text,
  View,
  type RefreshControlProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { useListScrollable } from "@/motion/heldTouch";

import { TitlePress, type TitleLongPress } from "./TitleLongPress";

type Props = {
  title: string;
  /** A single trailing control on the title line (e.g. Settings). */
  action?: ReactNode;
  /** What a long press on the title opens: the screen's options. */
  titleLongPress?: TitleLongPress | undefined;
  children?: ReactNode;
  /** Pull to refresh (a `RefreshControl`). */
  refreshControl?: ReactElement<RefreshControlProps>;
};

/**
 * A tab screen's quiet large title, with at most one trailing control on its
 * line. Given [titleLongPress], a long press on the title opens the screen's
 * options next to it.
 */
export function LargeTitle({
  title,
  action,
  titleLongPress,
}: {
  title: string;
  action?: ReactNode;
  titleLongPress?: TitleLongPress | undefined;
}) {
  return (
    <View
      className="flex-row items-end justify-between pb-4"
      style={{ paddingHorizontal: grid.margin }}
    >
      <TitlePress titleLongPress={titleLongPress}>
        <Text
          accessibilityRole="header"
          className="font-sans text-large-title font-light text-foreground"
          style={{ letterSpacing: -0.6 }}
        >
          {title}
        </Text>
      </TitlePress>
      {action}
    </View>
  );
}

/** Space above a large title: the status bar, then two cells. */
export const useLargeTitleTop = (): number => useSafeAreaInsets().top + 16;

/**
 * A screen with a quiet large title that scrolls with the content, under the
 * floating chrome. Tapping its tab while it is current scrolls back to the top.
 */
export function LargeTitleScreen({
  title,
  action,
  titleLongPress,
  children,
  refreshControl,
}: Props) {
  const scrollable = useListScrollable();
  const top = useLargeTitleTop();
  const bottom = useChromeInset();
  const scroll = useRef<ScrollViewInstance>(null);
  useScrollToTop(scroll);
  return (
    <ScrollView
      ref={scroll}
      scrollEnabled={scrollable}
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: top, paddingBottom: bottom }}
      contentInsetAdjustmentBehavior="never"
      refreshControl={refreshControl}
    >
      <LargeTitle title={title} action={action} titleLongPress={titleLongPress} />
      <View style={{ paddingHorizontal: grid.margin }}>{children}</View>
    </ScrollView>
  );
}
