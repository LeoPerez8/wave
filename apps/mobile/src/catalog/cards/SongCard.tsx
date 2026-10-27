import { IconPlayerPlay } from "@tabler/icons-react-native";
import { View } from "react-native";

import { useThemeColor } from "@/theme/useThemeColor";

import { Artwork } from "../Artwork";
import { CELL } from "../grid";

import { CardDetail, CardTile, CardTitle } from "./CardParts";

/**
 * A song's cover with a play disc on its bottom-right corner: the disc is
 * the ground at 82% opacity, with an outline play icon at half its size.
 * `disc` is its width; `inset` how far its right and bottom edges sit in from
 * the cover's (negative: they overhang it).
 */
export function SongCover({
  uri,
  tint,
  size,
  disc,
  inset,
}: {
  uri?: string | undefined;
  tint?: string | undefined;
  size: number;
  disc: number;
  inset: number;
}) {
  const foreground = useThemeColor("foreground");
  return (
    <View style={{ width: size, height: size }}>
      <Artwork uri={uri} tint={tint} size={size} radius={CELL / 2} />
      <View
        className="items-center justify-center"
        style={{ position: "absolute", width: disc, height: disc, right: inset, bottom: inset }}
      >
        <View
          className="bg-background"
          style={{
            position: "absolute",
            width: disc,
            height: disc,
            borderRadius: disc / 2,
            opacity: 0.82,
          }}
        />
        <IconPlayerPlay size={disc / 2} color={foreground} strokeWidth={1.5} />
      </View>
    </View>
  );
}

/**
 * A song's disc in a list row: a 40dp cover, the disc 20dp and overhanging the
 * cover's corner by 4dp. A song row with a `playDisc` leading cell (`SongRow`)
 * takes these.
 */
export const SONG_ROW_COVER = { disc: CELL * 2.5, inset: -CELL / 2 } as const;

/** A song on a shelf: a 104dp cover (about two thirds of an album's), its disc 8dp in from the corner. */
const TILE = { size: CELL * 13, disc: CELL * 3.5, inset: CELL } as const;

type Props = {
  title: string;
  /** The line under the title, "Song · <artist>" unless the caller says otherwise. */
  artist: string;
  artworkUri?: string | undefined;
  tint?: string | undefined;
  /** The tile's width, a grid's column; the 104dp shelf tile by default. The disc and inset scale with it. */
  size?: number | undefined;
  /** Read out instead of "<title>, song by <artist>" (a tile whose tap does something more particular). */
  label?: string | undefined;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
};

/** A song on a shelf or in a grid: its play-disc cover, the title and artist under it. */
export function SongCard({
  title,
  artist,
  artworkUri,
  tint,
  size = TILE.size,
  label,
  onPress,
  onLongPress,
}: Props) {
  const scale = size / TILE.size;
  return (
    <CardTile
      width={size}
      label={label ?? `${title}, song by ${artist}`}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <SongCover
        uri={artworkUri}
        tint={tint}
        size={size}
        disc={TILE.disc * scale}
        inset={TILE.inset * scale}
      />
      <View style={{ paddingTop: CELL }}>
        <CardTitle>{title}</CardTitle>
        <CardDetail size="footnote">{artist}</CardDetail>
      </View>
    </CardTile>
  );
}
