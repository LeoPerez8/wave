import { IconCircle, IconCircleCheckFilled } from "@tabler/icons-react-native";
import { View } from "react-native";

import { useThemeColor } from "@/theme/useThemeColor";

import { CELL, grid } from "./grid";

const MARK = 24;

/** The check itself: a filled accent check when checked, an empty ring otherwise. */
function CheckMark({ checked, ring }: { checked: boolean; ring: string }) {
  const accent = useThemeColor("accent");
  return checked ? (
    <IconCircleCheckFilled size={MARK} color={accent} />
  ) : (
    <IconCircle size={MARK} color={ring} strokeWidth={1.5} />
  );
}

/**
 * A row's leading check cell in selection mode (tracks, artists, genres,
 * folders, playlists): one state cell wide, so rows line up whatever they lead
 * with next.
 */
export function CheckCell({ checked }: { checked: boolean }) {
  const tertiary = useThemeColor("tertiary");
  return (
    <View className="items-center" style={{ width: grid.stateCell }}>
      <CheckMark checked={checked} ring={tertiary} />
    </View>
  );
}

/**
 * A tile's check in selection mode (albums…): in the artwork's top-right
 * corner, on a background disc so it reads over any cover. Place it inside a
 * box the size of the artwork.
 */
export function TileCheck({ checked }: { checked: boolean }) {
  const secondary = useThemeColor("secondary");
  return (
    <View
      pointerEvents="none"
      className="absolute items-center justify-center rounded-full bg-background"
      style={{ top: CELL, right: CELL, width: MARK + 4, height: MARK + 4 }}
    >
      <CheckMark checked={checked} ring={secondary} />
    </View>
  );
}
