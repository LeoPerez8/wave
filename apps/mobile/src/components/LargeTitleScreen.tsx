import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";

type Props = {
  title: string;
  /** A single trailing control on the title line (e.g. Settings). */
  action?: ReactNode;
  children?: ReactNode;
};

/** A screen with a quiet large title that scrolls with the content. */
export function LargeTitleScreen({ title, action, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 48 }}
      contentInsetAdjustmentBehavior="never"
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
