import { IconFolderOpen } from "@tabler/icons-react-native";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { useAllFilesAccess } from "@/library/hooks";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * Shown instead of the tabs until Wave holds all-files access. The root layout
 * swaps to the tabs as soon as access is granted and the app is active again.
 */
export default function AccessScreen() {
  const insets = useSafeAreaInsets();
  const tertiary = useThemeColor("tertiary");
  const { denied, request } = useAllFilesAccess();

  return (
    <View
      className="flex-1 bg-background"
      style={{
        paddingHorizontal: grid.margin,
        paddingTop: insets.top + CELL * 12,
        paddingBottom: insets.bottom + CELL * 4,
        gap: CELL * 2,
      }}
    >
      <IconFolderOpen size={40} color={tertiary} strokeWidth={1.25} />
      <Text
        accessibilityRole="header"
        className="font-sans text-large-title font-light text-foreground"
        style={{ letterSpacing: -0.6 }}
      >
        {denied ? "Wave can't see your music yet" : "Allow access to your music"}
      </Text>
      <Text className="font-sans text-body text-secondary">
        {denied
          ? "All files access is still off. Turn on “Allow access to manage all files” for Wave, then come back."
          : "Wave plays the audio files on this phone. To find them, it needs “All files access”, which you turn on in Android settings."}
      </Text>
      <View className="items-start">
        <TextButton label={denied ? "Try again" : "Open settings"} onPress={request} />
      </View>
    </View>
  );
}
