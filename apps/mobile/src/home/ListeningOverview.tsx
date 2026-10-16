import { View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TitledSection } from "@/catalog/TitledSection";
import { TotalsLine } from "@/catalog/TotalsLine";
import { useListeningOverview } from "@/library/hooks";

/**
 * Home's Listening overview (last by default): the library's songs, albums and artists, then all-time
 * listening (minutes listened, songs listened, plays), as Core sums them up.
 */
export function ListeningOverview() {
  const overview = useListeningOverview();
  if (overview === undefined) return null;
  return (
    <TitledSection title="Listening overview">
      <View style={{ gap: CELL / 2 }}>
        <TotalsLine totals={overview.library} />
        <TotalsLine totals={overview.listening} />
      </View>
    </TitledSection>
  );
}
