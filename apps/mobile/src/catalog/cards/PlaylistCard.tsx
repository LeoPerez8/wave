import type { ImportRing } from "@wave/core";
import { useColorScheme, View, type PressableProps } from "react-native";

import { CoverRing } from "../CoverRing";
import { CELL } from "../grid";
import { Mosaic } from "../Mosaic";
import { TileCheck } from "../CheckCell";
import { useLocalisation } from "@/localisation/localisation";

import { CAPTION_TOP, CardDetail, CardRow, CardTile, CardTitle } from "./CardParts";
import { coverTop, ROW_SLEEVES, TILE_SLEEVES } from "./sleeves";

/** The playlist's mosaic in a row: 40dp. */
const THUMB = CELL * 5;

/** The room a tile's sleeves take above its cover: two bars, each with its gap. */
export const SLEEVE_ROOM = coverTop({ sleeves: true });

/**
 * A playlist's mosaic with two sleeves behind it, showing as edges above: the
 * nearer one 88% of the cover's width, the farther 76%, each a tone quieter.
 * A row's sleeves are smaller than a tile's, and without [sleeves] the cover
 * shows alone. A tile's [checked] puts a check over the cover's corner, and an
 * importing playlist's [ring] shows over it.
 */
function StackedMosaic({
  paths,
  tints,
  size,
  radius,
  small = false,
  sleeves,
  checked,
  ring,
}: {
  paths: readonly string[];
  tints?: readonly (string | undefined)[];
  size: number;
  radius: number;
  small?: boolean;
  sleeves: boolean;
  checked?: boolean | undefined;
  ring?: ImportRing | null | undefined;
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
    <View style={{ paddingTop: coverTop({ sleeves, small }) }}>
      {sleeves && sleeve(size * 0.76, 0, true)}
      {sleeves && sleeve(size * 0.88, edge + gap, false)}
      <View>
        <Mosaic paths={paths} tints={tints} size={size} radius={radius} />
        {checked !== undefined && <TileCheck checked={checked} />}
        {ring != null && <CoverRing ring={ring} cover={size} />}
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
  /** While the playlist imports, the ring over its cover (Core's `importRing`). */
  ring?: ImportRing | null | undefined;
  /** Actions for screen readers beyond a tap and a long press (Move up, Move down). */
  accessibilityActions?: PressableProps["accessibilityActions"];
  onAccessibilityAction?: PressableProps["onAccessibilityAction"];
  /** Whether sleeves show above the cover: on Home and in Search, not on the Playlists page. */
  sleeves?: boolean | undefined;
};

/**
 * A playlist on a shelf or in a grid: its mosaic at [size] with sleeves above
 * (unless [sleeves] is false), the name and song count under. [nameInset] keeps the caption clear of what
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
  ring,
  accessibilityActions,
  onAccessibilityAction,
  sleeves = true,
  nameInset,
}: Props & { size: number; nameInset?: number | undefined }) {
  const { strings } = useLocalisation();
  return (
    <CardTile
      width={size}
      label={label ?? strings.library.playlistLabel(name, detail)}
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
        sleeves={sleeves}
        checked={checked}
        ring={ring}
      />
      <View style={{ paddingTop: CAPTION_TOP, paddingRight: nameInset }}>
        <CardTitle>{name}</CardTitle>
        <CardDetail size="footnote">{detail}</CardDetail>
      </View>
    </CardTile>
  );
}

/**
 * A playlist in a list: a 40dp mosaic with 3dp corners and smaller sleeves
 * (unless [sleeves] is false), then "Playlist · <count>".
 */
export function PlaylistCardRow({
  name,
  detail,
  plainDetail = false,
  paths,
  tints,
  onPress,
  onLongPress,
  checked,
  ring,
  accessibilityActions,
  onAccessibilityAction,
  sleeves = true,
}: Props & { plainDetail?: boolean }) {
  const { strings } = useLocalisation();
  return (
    <CardRow
      lead={
        <StackedMosaic
          paths={paths}
          tints={tints}
          size={THUMB}
          radius={CELL * 0.375}
          small
          sleeves={sleeves}
          ring={ring}
        />
      }
      title={name}
      detail={plainDetail ? detail : strings.library.playlistRow(detail)}
      onPress={onPress}
      onLongPress={onLongPress}
      checked={checked}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
    />
  );
}
