import { IconArrowLeft } from "@tabler/icons-react-native";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";

import { IconButton } from "./IconButton";

/**
 * The header of a pushed screen: back, then the title in the same quiet voice.
 * Screens that set their title in their content (an album under its cover) omit it.
 */
export function ScreenHeader({ title }: { title?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="bg-background" style={{ paddingTop: insets.top + 4 }}>
      <View style={{ paddingHorizontal: grid.margin - 12 }}>
        <IconButton icon={IconArrowLeft} label="Back" onPress={() => router.back()} />
      </View>
      {title !== undefined && (
        <View style={{ paddingHorizontal: grid.margin, paddingBottom: 16 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            className="font-sans text-title1 font-light text-foreground"
            style={{ letterSpacing: -0.4 }}
          >
            {title}
          </Text>
        </View>
      )}
    </View>
  );
}
