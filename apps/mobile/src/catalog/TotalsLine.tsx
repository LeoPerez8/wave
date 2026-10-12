import { Text, View } from "react-native";

/**
 * One line of totals, e.g. "2,500 songs · 600 albums · 800 artists". Each
 * total is its own text, so screen readers read it whole and wrapping never
 * splits a number from its label; the dots are left out for screen readers.
 */
export function TotalsLine({ totals }: { totals: readonly string[] }) {
  return (
    <View className="flex-row flex-wrap">
      {totals.map((total, index) => (
        // The line is fixed for a render and two totals may read the same, so place is the key.
        // oxlint-disable-next-line react/no-array-index-key
        <View key={index} className="flex-row">
          {index > 0 && (
            <Text
              className="font-sans text-subheadline text-secondary"
              accessible={false}
              importantForAccessibility="no"
            >
              {" · "}
            </Text>
          )}
          <Text className="font-sans text-subheadline text-secondary" accessibilityLabel={total}>
            {total}
          </Text>
        </View>
      ))}
    </View>
  );
}
