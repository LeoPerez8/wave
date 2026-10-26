import { Text, View } from "react-native";

import { Press } from "@/motion/Press";

import { ArtistImage, type ArtistImageSource } from "./ArtistImage";
import { CheckCell } from "./CheckCell";
import { CELL, grid } from "./grid";
import { RankNumber } from "./RankNumber";

type Props = {
  name: string;
  /** The quiet second line: counts, a path. */
  detail: string;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  unavailable?: boolean | undefined;
  /** In a ranking: the entry's rank, shown leading (the top one in ember). */
  rank?: { readonly number: number; readonly top: boolean } | undefined;
  /** An artist row: the artist, whose image leads the row (after the rank). */
  artist?: ArtistImageSource | undefined;
  /**
   * In selection mode, whether the row is checked: it leads with a check cell
   * and reads as a checkbox. Undefined outside selection mode.
   */
  checked?: boolean | undefined;
};

/** The artist circle in a row: a track row's thumbnail size. */
const ARTIST_THUMB = CELL * 5;

/**
 * An artist or genre in a list: the name over a graphite detail line,
 * at one size like a track row, 56dp so long lists lay out by index. Artists
 * lead with their image.
 */
export function NameRow({
  name,
  detail,
  onPress,
  onLongPress,
  rank,
  artist,
  checked,
  unavailable,
}: Props) {
  const selecting = checked !== undefined;
  return (
    <Press
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={`${name}, ${detail}`}
      accessibilityState={
        selecting ? { checked, disabled: unavailable } : { disabled: unavailable }
      }
      disabled={unavailable}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="selection"
      depth={0.015}
    >
      <View
        className="flex-row items-center"
        style={{ height: grid.row, gap: CELL * 1.5, opacity: unavailable ? 0.4 : 1 }}
      >
        {selecting && <CheckCell checked={checked} />}
        {rank !== undefined && <RankNumber rank={rank.number} top={rank.top} />}
        {artist !== undefined && <ArtistImage artist={artist} size={ARTIST_THUMB} />}
        <View className="flex-1 justify-center">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {name}
          </Text>
          <Text
            numberOfLines={1}
            className="font-sans text-body text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {detail}
          </Text>
        </View>
      </View>
    </Press>
  );
}
