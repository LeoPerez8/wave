import { View } from "react-native";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL } from "@/catalog/grid";

/** Enough placeholder tiles to fill the row past the screen's edge, as the mixes do. */
const TILES = 3;

/**
 * A text line's placeholder: a fill bar [width] wide (a share of the tile),
 * centred in a box as tall as the line it stands for, so the tile keeps the
 * mix tile's height.
 */
function Line({ lineHeight, width }: { lineHeight: number; width: `${number}%` }) {
  return (
    <View className="justify-center" style={{ height: lineHeight }}>
      <View className="bg-fill" style={{ width, height: lineHeight / 2, borderRadius: CELL / 4 }} />
    </View>
  );
}

/**
 * One mix tile's stand-in, laid out as `AlbumTile` is at the row's size: the
 * artwork's square, the caption line, two title lines and the songs line
 * (their line heights are global.css's catalog, body and footnote).
 */
function TileSkeleton() {
  return (
    <View style={{ width: COVER_ROW_TILE }}>
      <View className="bg-fill" style={{ width: COVER_ROW_TILE, height: COVER_ROW_TILE }} />
      <View style={{ paddingTop: CELL * 1.5, gap: CELL / 4 }}>
        <Line lineHeight={16} width="60%" />
        <View style={{ minHeight: CELL * 5.5 }}>
          <Line lineHeight={22} width="85%" />
        </View>
        <Line lineHeight={18} width="35%" />
      </View>
    </View>
  );
}

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
        {Array.from({ length: TILES }, (_, index) => (
          <TileSkeleton key={index} />
        ))}
      </CoverRow>
    </View>
  );
}
