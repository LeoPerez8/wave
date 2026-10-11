import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = {
  title: string;
  children?: ReactNode;
};

/** A screen with an Apple-style large title that scrolls with the content. */
export function LargeTitleScreen({ title, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 24 }}
      contentInsetAdjustmentBehavior="never"
    >
      <Text
        accessibilityRole="header"
        className="px-5 pb-2 font-sans text-large-title font-bold tracking-tight text-foreground"
      >
        {title}
      </Text>
      <View className="px-5">{children}</View>
    </ScrollView>
  );
}
