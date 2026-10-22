import { View } from "react-native";

import { Artwork } from "../Artwork";
import { CELL } from "../grid";

import { CardDetail, CardRow, CardTile, CardTitle } from "./CardParts";

/** The album's cover in a row: 40dp, 4dp corners. */
const THUMB = CELL * 5;

type Props = {
  title: string;
  /** The album's artist, the line under the title. */
  artist: string;
  /** File URI of the cached artwork; absent when there is none. */
  artworkUri?: string | undefined;
  tint?: string | undefined;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
};

/** An album on a shelf or in a grid: a square cover at [size], 6dp corners, the title and artist under it. */
export function AlbumCard({
  title,
  artist,
  artworkUri,
  tint,
  size,
  onPress,
  onLongPress,
}: Props & { size: number }) {
  return (
    <CardTile
      width={size}
      label={`${title}, album by ${artist}`}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <Artwork uri={artworkUri} tint={tint} size={size} radius={CELL * 0.75} />
      <View style={{ paddingTop: CELL }}>
        <CardTitle>{title}</CardTitle>
        <CardDetail size="footnote">{artist}</CardDetail>
      </View>
    </CardTile>
  );
}

/** An album in a list: its cover at 40dp with 4dp corners, then "Album · <artist>". */
export function AlbumCardRow({ title, artist, artworkUri, tint, onPress, onLongPress }: Props) {
  return (
    <CardRow
      lead={<Artwork uri={artworkUri} tint={tint} size={THUMB} radius={CELL / 2} />}
      title={title}
      detail={`Album · ${artist}`}
      onPress={onPress}
      onLongPress={onLongPress}
    />
  );
}
