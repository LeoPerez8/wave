import { IconArrowLeft } from "@tabler/icons-react-native";
import { router } from "@/lib/timingRouter";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";

import { IconButton } from "./IconButton";
import { TitlePress, type TitleLongPress } from "./TitleLongPress";

/**
 * The header of a pushed screen: back, then the title in the same quiet voice.
 * Screens that set their title in their content (an album under its cover) omit it.
 * Given [titleLongPress], a long press on the title opens the screen's options
 * next to it, as on a large title.
 */
export function ScreenHeader({
  title,
  titleLongPress,
}: {
  title?: string;
  titleLongPress?: TitleLongPress | undefined;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View className="bg-background" style={{ paddingTop: insets.top + 4 }}>
      <View style={{ paddingHorizontal: grid.margin - 12 }}>
        <IconButton icon={IconArrowLeft} label="Back" onPress={() => router.back()} />
      </View>
      {title !== undefined && (
        <View
          // A title that takes a long press hugs its text, so its highlight does too.
          className={titleLongPress === undefined ? undefined : "items-start"}
          style={{ paddingHorizontal: grid.margin, paddingBottom: 16 }}
        >
          <TitlePress titleLongPress={titleLongPress}>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              className="font-sans text-title1 font-light text-foreground"
              style={{ letterSpacing: -0.4 }}
            >
              {title}
            </Text>
          </TitlePress>
        </View>
      )}
    </View>
  );
}
