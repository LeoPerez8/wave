import { View } from "react-native";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { SKELETON_TILES, TileSkeleton } from "@/catalog/Skeletons";

/**
 * The Discover mixes row while the first mixes build (Core's
 * `discoverMixesSection`): placeholder tiles in the mixes' layout and size.
 * It holds still: an animated pulse would make the glass chrome re-blur on
 * every frame (issue #93), and stillness is what reduce motion asks for anyway.
 */
export function DiscoverMixesSkeleton() {
  return (
    <View accessible accessibilityLabel="Building your mixes" accessibilityState={{ busy: true }}>
      <CoverRow>
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <TileSkeleton key={index} size={COVER_ROW_TILE} />
        ))}
      </CoverRow>
    </View>
  );
}
