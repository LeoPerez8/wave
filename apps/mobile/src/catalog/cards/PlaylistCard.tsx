import { useColorScheme, View } from "react-native";

import { CELL } from "../grid";
import { Mosaic } from "../Mosaic";

import { CardDetail, CardRow, CardTile, CardTitle } from "./CardParts";

/** The playlist's mosaic in a row: 40dp. */
const THUMB = CELL * 5;

/**
 * A playlist's mosaic with two sleeves behind it, showing as edges above: the
 * nearer one 88% of the cover's width, the farther 76%, each a tone quieter.
 * `edge` is a sleeve's height and `gap` the space between them; a row's are
 * smaller than a tile's.
 */
function StackedMosaic({
  paths,
  tints,
  size,
  radius,
  small = false,
}: {
  paths: readonly string[];
  tints?: readonly (string | undefined)[];
  size: number;
  radius: number;
  small?: boolean;
}) {
  const dark = useColorScheme() === "dark";
  const edge = small ? 2 : 3;
  const gap = small ? 1 : 2;
  const sleeve = (width: number, top: number, quiet: boolean) => {
    const tone = dark ? (quiet ? "bg-tone-8" : "bg-tone-7") : quiet ? "bg-tone-3" : "bg-tone-4";
    return (
      <View
        className={tone}
        style={{
          position: "absolute",
          top,
          left: (size - width) / 2,
          width,
          height: edge,
          borderTopLeftRadius: edge,
          borderTopRightRadius: edge,
        }}
      />
    );
  };
  return (
    <View style={{ paddingTop: (edge + gap) * 2 }}>
      {sleeve(size * 0.76, 0, true)}
      {sleeve(size * 0.88, edge + gap, false)}
      <Mosaic paths={paths} tints={tints} size={size} radius={radius} />
    </View>
  );
}

type Props = {
  name: string;
  /** The song count, under the name in a tile and after "Playlist · " in a row. */
  detail: string;
  /** Covers from Core's `playlistMosaic` (none, one or four). */
  paths: readonly string[];
  /** Solid fields standing in for the covers (the Design preview's synthetic ones). */
  tints?: readonly (string | undefined)[];
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
};

/** A playlist on a shelf or in a grid: its mosaic at [size] with sleeves above, the name and count under. */
export function PlaylistCard({
  name,
  detail,
  paths,
  tints,
  size,
  onPress,
  onLongPress,
}: Props & { size: number }) {
  return (
    <CardTile
      width={size}
      label={`${name}, playlist, ${detail}`}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <StackedMosaic paths={paths} tints={tints} size={size} radius={CELL * 0.75} />
      <View style={{ paddingTop: CELL }}>
        <CardTitle>{name}</CardTitle>
        <CardDetail size="footnote">{detail}</CardDetail>
      </View>
    </CardTile>
  );
}

/** A playlist in a list: a 40dp mosaic with 3dp corners and smaller sleeves, then "Playlist · <count>". */
export function PlaylistCardRow({ name, detail, paths, tints, onPress, onLongPress }: Props) {
  return (
    <CardRow
      lead={<StackedMosaic paths={paths} tints={tints} size={THUMB} radius={CELL * 0.375} small />}
      title={name}
      detail={`Playlist · ${detail}`}
      onPress={onPress}
      onLongPress={onLongPress}
    />
  );
}
