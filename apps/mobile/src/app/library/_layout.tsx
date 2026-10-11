import { Stack } from "expo-router";
import { View } from "react-native";

import { BACKDROP } from "@/chrome/chrome";
import { openNowPlaying } from "@/nowPlaying/sheet";
import { MiniPlayer } from "@/playback/MiniPlayer";
import { useThemeColor } from "@/theme/useThemeColor";

/** Library screens pushed over the tabs keep the floating mini player, above the system inset. */
export default function LibraryLayout() {
  const background = useThemeColor("background");
  return (
    <View className="flex-1 bg-background">
      <View nativeID={BACKDROP.library} collapsable={false} className="flex-1">
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background } }}
        />
      </View>
      <MiniPlayer backdropId={BACKDROP.library} onOpen={openNowPlaying} />
    </View>
  );
}
