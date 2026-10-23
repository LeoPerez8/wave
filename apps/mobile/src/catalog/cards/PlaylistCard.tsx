import { useColorScheme, View, type PressableProps } from "react-native";

import { CELL } from "../grid";
import { Mosaic } from "../Mosaic";
import { TileCheck } from "../CheckCell";

import { CAPTION_TOP, CardDetail, CardRow, CardTile, CardTitle } from "./CardParts";

/** The playlist's mosaic in a row: 40dp. */
const THUMB = CELL * 5;

/** A sleeve is a bar of this height and the gap after it: a tile's, then a row's (smaller). */
const TILE_SLEEVES = { edge: 3, gap: 2 } as const;
const ROW_SLEEVES = { edge: 2, gap: 1 } as const;

/** The room a tile's sleeves take above its cover: two bars, each with its gap. */
export const SLEEVE_ROOM = (TILE_SLEEVES.edge + TILE_SLEEVES.gap) * 2;

/**
 * A playlist's mosaic with two sleeves behind it, showing as edges above: the
 * nearer one 88% of the cover's width, the farther 76%, each a tone quieter.
 * A row's sleeves are smaller than a tile's. A tile's [checked] puts a check
 * over the cover's corner.
 */
function StackedMosaic({
  paths,
  tints,
  size,
  radius,
  small = false,
  checked,
}: {
  paths: readonly string[];
  tints?: readonly (string | undefined)[];
  size: number;
  radius: number;
  small?: boolean;
  checked?: boolean | undefined;
}) {
  const dark = useColorScheme() === "dark";
  const { edge, gap } = small ? ROW_SLEEVES : TILE_SLEEVES;
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
      <View>
        <Mosaic paths={paths} tints={tints} size={size} radius={radius} />
        {checked !== undefined && <TileCheck checked={checked} />}
      </View>
    </View>
  );
}

type Props = {
  name: string;
  /** A mix shares this tile's artwork treatment, with its own accessible identity. */
  label?: string | undefined;
  /** The song count: under the name in a tile, after "Playlist · " in a row. */
  detail: string;
  /** Covers from Core's `playlistMosaic` (none, one or four). */
  paths: readonly string[];
  /** Solid fields standing in for the covers (the Design preview's synthetic ones). */
  tints?: readonly (string | undefined)[];
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /** In selection mode, whether it is checked: a check on the cover (tile), a leading check cell (row). */
  checked?: boolean | undefined;
  /** Actions for screen readers beyond a tap and a long press (Move up, Move down). */
  accessibilityActions?: PressableProps["accessibilityActions"];
  onAccessibilityAction?: PressableProps["onAccessibilityAction"];
};

/**
 * A playlist on a shelf or in a grid: its mosaic at [size] with sleeves above,
 * the name and song count under. [nameInset] keeps the caption clear of what
 * sits over its end (a drag handle).
 */
export function PlaylistCard({
  name,
  label,
  detail,
  paths,
  tints,
  size,
  onPress,
  onLongPress,
  checked,
  accessibilityActions,
  onAccessibilityAction,
  nameInset,
}: Props & { size: number; nameInset?: number | undefined }) {
  return (
    <CardTile
      width={size}
      label={label ?? `${name}, playlist, ${detail}`}
      onPress={onPress}
      onLongPress={onLongPress}
      checked={checked}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
    >
      <StackedMosaic
        paths={paths}
        tints={tints}
        size={size}
        radius={CELL * 0.75}
        checked={checked}
      />
      <View style={{ paddingTop: CAPTION_TOP, paddingRight: nameInset }}>
        <CardTitle>{name}</CardTitle>
        <CardDetail size="footnote">{detail}</CardDetail>
      </View>
    </CardTile>
  );
}

/** A playlist in a list: a 40dp mosaic with 3dp corners and smaller sleeves, then "Playlist · <count>". */
export function PlaylistCardRow({
  name,
  detail,
  paths,
  tints,
  onPress,
  onLongPress,
  checked,
  accessibilityActions,
  onAccessibilityAction,
}: Props) {
  return (
    <CardRow
      lead={<StackedMosaic paths={paths} tints={tints} size={THUMB} radius={CELL * 0.375} small />}
      title={name}
      detail={`Playlist · ${detail}`}
      onPress={onPress}
      onLongPress={onLongPress}
      checked={checked}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
    />
  );
}
