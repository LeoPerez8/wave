import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL, grid } from "@/catalog/grid";
import { RankNumber } from "@/catalog/RankNumber";
import { Press } from "@/motion/Press";

type Props = {
  title: string;
  detail: string;
  artworkUri: string | undefined;
  onPress: () => void;
  onLongPress?: () => void;
  /** In a ranking: the entry's rank, shown leading (the top one in ember). */
  rank?: { readonly number: number; readonly top: boolean } | undefined;
};

const THUMB = CELL * 5;

/** An album in search results or a ranking: a track row's thumbnail and two lines, without track cells. */
export function ArtworkRow({ title, detail, artworkUri, onPress, onLongPress, rank }: Props) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}`}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="selection"
      depth={0.015}
    >
      <View className="flex-row items-center" style={{ height: grid.row, gap: CELL * 1.5 }}>
        {rank !== undefined && <RankNumber rank={rank.number} top={rank.top} />}
        <Artwork uri={artworkUri} size={THUMB} />
        <View className="flex-1">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {title}
          </Text>
          <Text numberOfLines={1} className="font-sans text-body text-secondary">
            {detail}
          </Text>
        </View>
      </View>
    </Press>
  );
}
