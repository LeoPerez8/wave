import { Text, View } from "react-native";

import { Press } from "@/motion/Press";

import { Artwork } from "./Artwork";
import { CatalogLine } from "./CatalogLine";
import { CELL } from "./grid";

export type AlbumSummary = {
  id: string;
  title: string;
  albumArtist: string;
  year?: number | undefined;
  trackCount: number;
  durationMs: number;
  artworkUri?: string | undefined;
  tint?: string | undefined;
};

const minutes = (album: AlbumSummary): number => Math.max(1, Math.round(album.durationMs / 60_000));

/**
 * "1975 · 9 · 41 min": the same furniture line on every album, in the same
 * place, short enough to never truncate in a two-column grid.
 */
export const furnitureLine = (album: AlbumSummary): string =>
  [album.year, album.trackCount, `${minutes(album)} min`]
    .filter((part) => part !== undefined)
    .join(" · ");

const furnitureLabel = (album: AlbumSummary): string =>
  [
    album.year,
    `${album.trackCount} ${album.trackCount === 1 ? "track" : "tracks"}`,
    `${minutes(album)} minutes`,
  ]
    .filter((part) => part !== undefined)
    .join(", ");

type Props = {
  album: AlbumSummary;
  size: number;
  onPress: () => void;
  onLongPress?: () => void;
  /** Replaces the furniture line (e.g. "12 plays" on a Most played shelf), read out after the title. */
  detail?: string | undefined;
};

export function AlbumTile({ album, size, onPress, onLongPress, detail }: Props) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${album.title} by ${album.albumArtist}, ${detail ?? furnitureLabel(album)}`}
      onPress={onPress}
      onLongPress={onLongPress}
      depth={0.02}
      style={{ width: size }}
    >
      <Artwork uri={album.artworkUri} tint={album.tint} size={size} />
      <View style={{ paddingTop: CELL * 1.5, gap: CELL / 4 }}>
        <CatalogLine>{album.albumArtist}</CatalogLine>
        {/* Two lines reserved, so the furniture line lands in the same place on every tile. */}
        <Text
          numberOfLines={2}
          className="font-sans text-body font-medium text-foreground"
          style={{ minHeight: CELL * 5.5 }}
        >
          {album.title}
        </Text>
        <Text
          numberOfLines={1}
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {detail ?? furnitureLine(album)}
        </Text>
      </View>
    </Press>
  );
}
