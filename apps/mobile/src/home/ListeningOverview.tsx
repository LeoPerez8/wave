import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { useListeningOverview } from "@/library/hooks";

import { HomeSection } from "./HomeSections";

/**
 * One line of totals, e.g. "2,500 songs · 600 albums · 800 artists". Each
 * total is its own text, so screen readers read it whole and wrapping never
 * splits a number from its label; the dots are left out for screen readers.
 */
export function TotalsLine({ totals }: { totals: readonly string[] }) {
  return (
    <View className="flex-row flex-wrap">
      {totals.map((total, index) => (
        <View key={total} className="flex-row">
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

/**
 * Home's last section: the library's songs, albums and artists, then all-time
 * listening (minutes listened, songs listened, plays), as Core sums them up.
 */
export function ListeningOverview() {
  const overview = useListeningOverview();
  if (overview === undefined) return null;
  return (
    <HomeSection title="Listening overview">
      <View style={{ gap: CELL / 2 }}>
        <TotalsLine totals={overview.library} />
        <TotalsLine totals={overview.listening} />
      </View>
    </HomeSection>
  );
}
