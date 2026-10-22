import { View, useWindowDimensions } from "react-native";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { SLEEVE_ROOM } from "@/catalog/cards/PlaylistCard";
import { AlbumCardSkeleton, SKELETON_TILES, SkeletonGroup } from "@/catalog/Skeletons";

/**
 * The Discover mixes row while the first mixes build (Core's
 * `discoverMixesSection`): placeholder tiles in the mixes' layout and size.
 * It holds still: an animated pulse would make the glass chrome re-blur on
 * every frame (issue #93), and stillness is what reduce motion asks for anyway.
 */
export function DiscoverMixesSkeleton() {
  const { fontScale } = useWindowDimensions();
  return (
    <SkeletonGroup label="Building your mixes">
      <CoverRow>
        {Array.from({ length: SKELETON_TILES }, (_, index) => (
          <View key={index} style={{ width: COVER_ROW_TILE, paddingTop: SLEEVE_ROOM }}>
            <View
              className="bg-fill"
              style={{
                position: "absolute",
                top: 0,
                left: COVER_ROW_TILE * 0.12,
                width: COVER_ROW_TILE * 0.76,
                height: 3,
                borderRadius: 3,
              }}
            />
            <View
              className="bg-fill"
              style={{
                position: "absolute",
                top: SLEEVE_ROOM / 2,
                left: COVER_ROW_TILE * 0.06,
                width: COVER_ROW_TILE * 0.88,
                height: 3,
                borderRadius: 3,
              }}
            />
            <AlbumCardSkeleton size={COVER_ROW_TILE} fontScale={fontScale} />
          </View>
        ))}
      </CoverRow>
    </SkeletonGroup>
  );
}
