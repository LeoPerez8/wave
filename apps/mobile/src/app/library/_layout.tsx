import { Stack } from "expo-router";
import { View } from "react-native";

import { MiniPlayer } from "@/playback/MiniPlayer";
import { useThemeColor } from "@/theme/useThemeColor";

/** Library screens pushed over the tabs keep the mini player at the bottom. */
export default function LibraryLayout() {
  const background = useThemeColor("background");
  return (
    <View className="flex-1 bg-background">
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background } }}
      />
      <MiniPlayer inset />
    </View>
  );
}
