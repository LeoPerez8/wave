import type { ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";

import { CELL } from "@/catalog/grid";
import { homeStatsRowLayout } from "./homeOpening";

/** The same growing row for Stats facts and their placeholders. */
export function StatsFactRow({ children }: { children: ReactNode }) {
  const { fontScale } = useWindowDimensions();
  const { stacked, minHeight } = homeStatsRowLayout(fontScale);
  return (
    <View
      accessible
      style={{
        minHeight,
        flexDirection: stacked ? "column" : "row",
        alignItems: stacked ? "flex-start" : "center",
        justifyContent: stacked ? "center" : "space-between",
        columnGap: CELL * 2,
        paddingVertical: CELL,
      }}
    >
      {children}
    </View>
  );
}
