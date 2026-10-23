import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { CELL } from "@/catalog/grid";

import { TextButton } from "./TextButton";

/**
 * The quiet line a recommendation surface shows when its read failed, with
 * Try Again ([onRetry]) at its end: Up Next's Magic Queue batch, a Discover
 * mix row.
 */
export function RecommendationsFailed({
  onRetry,
  style,
}: {
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View className="flex-row items-center" style={[{ gap: CELL }, style]}>
      <Text
        accessibilityLiveRegion="polite"
        className="flex-1 font-sans text-subheadline text-secondary"
      >
        Couldn't load recommendations.
      </Text>
      <TextButton label="Try Again" onPress={onRetry} />
    </View>
  );
}
