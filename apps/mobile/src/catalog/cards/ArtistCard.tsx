import { View } from "react-native";

import { ArtistImage, type ArtistImageSource } from "../ArtistImage";
import { CELL } from "../grid";
import { useLocalisation } from "@/localisation/localisation";

import { CardRow, CardTile, CardTitle } from "./CardParts";

/** The artist's circle in a row: 40dp. */
const THUMB = CELL * 5;

type Props = {
  /** The artist's name: the title under the circle, or beside it in a row. */
  name: string;
  /** The artist's image: a downloaded photo, else album artwork, else the initial. */
  artist: ArtistImageSource;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
};

/** An artist on a shelf or in a grid: a circle as wide as [size], the name centred under it. */
export function ArtistCard({ name, artist, size, onPress, onLongPress }: Props & { size: number }) {
  const { strings } = useLocalisation();
  return (
    <CardTile
      width={size}
      label={strings.library.artistLabel(name)}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <ArtistImage artist={artist} size={size} large />
      <View style={{ paddingTop: CELL }}>
        <CardTitle centred>{name}</CardTitle>
      </View>
    </CardTile>
  );
}

/**
 * An artist in a list: a 40dp circle, the name over "Artist" (or [detail] when
 * given). In selection mode ([checked] given) it leads with a check cell.
 */
export function ArtistCardRow({
  name,
  artist,
  detail,
  onPress,
  onLongPress,
  checked,
}: Props & { detail?: string | undefined; checked?: boolean | undefined }) {
  const { strings } = useLocalisation();
  return (
    <CardRow
      lead={<ArtistImage artist={artist} size={THUMB} />}
      title={name}
      detail={detail ?? strings.library.artistRow}
      onPress={onPress}
      onLongPress={onLongPress}
      checked={checked}
    />
  );
}
