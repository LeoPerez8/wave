import { Text, View } from "react-native";

import { Press } from "@/motion/Press";

import { Artwork } from "./Artwork";
import { CatalogLine } from "./CatalogLine";
import { TileCheck } from "./CheckCell";
import { CELL } from "./grid";
import { useLocalisation } from "@/localisation/localisation";

type Props = {
  /** The tile's two-line title. */
  title: string;
  /** The catalog line above the title (the artist). */
  byline: string;
  /** The one-line detail under the title, read out after it. */
  detail: string;
  artworkUri?: string | undefined;
  tint?: string | undefined;
  size: number;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /**
   * In selection mode, whether the tile is checked: its artwork shows a check
   * in the corner and it reads as a checkbox. Undefined outside selection mode.
   */
  checked?: boolean | undefined;
  /** The detail as TalkBack reads it; absent: [detail]. */
  detailLabel?: string | undefined;
};

/**
 * A cover with the artist, a two-line title and a detail line under it: an
 * album's tile (`AlbumTile`), or a song's (Home's Magic Queue section).
 */
export function CoverTile({
  title,
  byline,
  detail,
  artworkUri,
  tint,
  size,
  onPress,
  onLongPress,
  checked,
  detailLabel,
}: Props) {
  const { strings } = useLocalisation();
  const selecting = checked !== undefined;
  return (
    <Press
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={strings.library.coverLabel(title, byline, detailLabel ?? detail)}
      accessibilityState={selecting ? { checked } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      depth={0.02}
      style={{ width: size }}
    >
      <View>
        <Artwork uri={artworkUri} tint={tint} size={size} />
        {selecting && <TileCheck checked={checked} />}
      </View>
      <View style={{ paddingTop: CELL * 1.5, gap: CELL / 4 }}>
        <CatalogLine>{byline}</CatalogLine>
        {/* Two lines reserved, so the detail line lands in the same place on every tile. */}
        <Text
          numberOfLines={2}
          className="font-sans text-body font-medium text-foreground"
          style={{ minHeight: CELL * 5.5 }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {detail}
        </Text>
      </View>
    </Press>
  );
}
