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

/** "1975 · 9 tracks · 41 min": the same furniture line on every album, in the same place. */
export const furnitureLine = (album: AlbumSummary): string =>
  [
    album.year,
    `${album.trackCount} ${album.trackCount === 1 ? "track" : "tracks"}`,
    `${Math.max(1, Math.round(album.durationMs / 60_000))} min`,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

type Props = { album: AlbumSummary; size: number; onPress: () => void };

export function AlbumTile({ album, size, onPress }: Props) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${album.title} by ${album.albumArtist}`}
      onPress={onPress}
      depth={0.02}
      style={{ width: size }}
    >
      <Artwork uri={album.artworkUri} tint={album.tint} size={size} />
      <View style={{ paddingTop: CELL * 1.5, gap: CELL / 4 }}>
        <CatalogLine>{album.albumArtist}</CatalogLine>
        <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
          {album.title}
        </Text>
        <Text
          numberOfLines={1}
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {furnitureLine(album)}
        </Text>
      </View>
    </Press>
  );
}
