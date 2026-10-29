import { useLocalisation } from "@/localisation/localisation";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";

import { CELL } from "@/catalog/grid";

import { TextButton } from "./TextButton";

/**
 * The quiet line a recommendation surface shows when its read failed, with
 * Try Again ([onRetry]) at its end: Up Next's Magic Queue batch, a Discover
 * mix row. [message] says something else (Up Next's "No songs found like …").
 */
export function RecommendationsFailed({
  onRetry,
  style,
  message,
}: {
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
  message?: string;
}) {
  const { strings } = useLocalisation();
  return (
    <View className="flex-row items-center" style={[{ gap: CELL }, style]}>
      <Text
        accessibilityLiveRegion="polite"
        className="flex-1 font-sans text-subheadline text-secondary"
      >
        {message ?? strings.discover.recommendationsFailed}
      </Text>
      <TextButton label={strings.discover.tryAgain} onPress={onRetry} />
    </View>
  );
}
