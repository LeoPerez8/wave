import { Text, View } from "react-native";

import { grid } from "@/catalog/grid";
import { ScreenHeader } from "@/components/ScreenHeader";
import { usePlayback } from "@/playback/hooks";

/** Placeholder the mini player opens; the full Now Playing screen replaces it (#9). */
export default function NowPlayingScreen() {
  const { item } = usePlayback();
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Now Playing" />
      <View style={{ paddingHorizontal: grid.margin }}>
        <Text className="font-sans text-body font-medium text-foreground">
          {item?.title ?? "Nothing playing"}
        </Text>
        {item !== null && (
          <Text className="font-sans text-body text-secondary">
            {item.artist ?? "Unknown Artist"}
          </Text>
        )}
      </View>
    </View>
  );
}
