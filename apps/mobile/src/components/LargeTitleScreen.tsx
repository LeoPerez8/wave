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

type Props = {
  title: string;
  /** A single trailing control on the title line (e.g. Settings). */
  action?: ReactNode;
  children?: ReactNode;
  /** Pull to refresh (a `RefreshControl`). */
  refreshControl?: ReactElement<RefreshControlProps>;
};

/**
 * A screen with a quiet large title that scrolls with the content, under the
 * floating chrome. Tapping its tab while it is current scrolls back to the top.
 */
export function LargeTitleScreen({ title, action, children, refreshControl }: Props) {
  const scrollable = useListScrollable();
  const insets = useSafeAreaInsets();
  const bottom = useChromeInset();
  const scroll = useRef<ScrollViewInstance>(null);
  useScrollToTop(scroll);
  return (
    <ScrollView
      ref={scroll}
      scrollEnabled={scrollable}
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: bottom }}
      contentInsetAdjustmentBehavior="never"
      refreshControl={refreshControl}
    >
      <View
        className="flex-row items-end justify-between"
        style={{ paddingHorizontal: grid.margin, paddingBottom: 16 }}
      >
        <Text
          accessibilityRole="header"
          className="font-sans text-large-title font-light text-foreground"
          style={{ letterSpacing: -0.6 }}
        >
          {title}
        </Text>
        {action}
      </View>
      <View style={{ paddingHorizontal: grid.margin }}>{children}</View>
    </ScrollView>
  );
}
