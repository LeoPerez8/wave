import { IconFolderOpen, IconLockAccess } from "@tabler/icons-react-native";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { useAllFilesAccess } from "@/library/hooks";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * Shown instead of the tabs until Wave holds all-files access. The root layout
 * swaps to the tabs as soon as access is granted and the app is active again.
 */
export default function AccessScreen() {
  const insets = useSafeAreaInsets();
  const accent = useThemeColor("accent");
  const { denied, request } = useAllFilesAccess();
  const Icon = denied ? IconLockAccess : IconFolderOpen;

  return (
    <View
      className="flex-1 justify-between bg-background px-8"
      style={{ paddingTop: insets.top + 96, paddingBottom: insets.bottom + 32 }}
    >
      <View className="items-center gap-3">
        <Icon size={64} color={accent} strokeWidth={1.5} />
        <Text className="mt-4 text-center font-sans text-title1 font-bold text-foreground">
          {denied ? "Wave can't see your music yet" : "Allow access to your music"}
        </Text>
        <Text className="text-center font-sans text-body text-secondary">
          {denied
            ? "All files access is still off. Turn on “Allow access to manage all files” for Wave, then come back."
            : "Wave plays the audio files on this phone. To find them in your Music folder, it needs “All files access”, which you turn on in Android settings."}
        </Text>
      </View>
      <Button label={denied ? "Try Again" : "Open Settings"} onPress={request} />
    </View>
  );
}
