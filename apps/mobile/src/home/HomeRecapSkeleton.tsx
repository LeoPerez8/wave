import { View, useWindowDimensions } from "react-native";

import { CELL } from "@/catalog/grid";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import { SkeletonGroup } from "@/catalog/Skeletons";
import { recapCardHeight } from "@/stats/recapAnnouncement";

/** Availability has its own read; an arriving Recap keeps the section positions below it. */
export function HomeRecapSkeleton() {
  const { fontScale } = useWindowDimensions();
  const scale = Math.max(1, fontScale);
  return (
    <SkeletonGroup label="Loading Recap">
      <View style={{ padding: CELL * 2, gap: CELL / 2, minHeight: recapCardHeight(fontScale) }}>
        <SkeletonLine lineHeight={18 * scale} width="65%" />
        <SkeletonLine lineHeight={28 * scale} width="85%" />
        <SkeletonLine lineHeight={20 * scale} width="45%" />
      </View>
    </SkeletonGroup>
  );
}
