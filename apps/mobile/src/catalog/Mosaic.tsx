import { View } from "react-native";

import { artworkUri } from "./artworkUri";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { Artwork } from "./Artwork";

type Props = {
  /**
   * Covers from Core's `playlistMosaic`: none, one, or four. Each a cached
   * artwork file, or a YT Music entry's cover address.
   */
  paths: readonly string[];
  /** Solid fields standing in for the covers (synthetic preview covers), as `Artwork`'s `tint`. */
  tints?: readonly (string | undefined)[];
  size: number;
  /** Corner radius of the whole mosaic, clipped to it; square by default. */
  radius?: number | undefined;
};

/** Local artwork stays available while YT Music is off; remote covers follow its switch. */
const uri = (path: string | undefined, ytMusic: boolean): string | undefined =>
  path !== undefined && (!/^https?:/i.test(path) || ytMusic)
    ? artworkUri(path, "original")
    : undefined;

/**
 * A playlist's artwork: four album covers in a 2×2 square, butted together
 * with no gutter or frame, or a single cover when there are fewer than four.
 */
export function Mosaic({ paths, tints, size, radius }: Props) {
  const ytMusic = useYtMusicEnabled();
  const count = tints === undefined ? paths.length : tints.length;
  if (count < 4)
    return (
      <Artwork
        uri={tints === undefined ? uri(paths[0], ytMusic) : undefined}
        tint={tints?.[0]}
        size={size}
        radius={radius}
      />
    );
  const half = size / 2;
  return (
    <View
      accessibilityIgnoresInvertColors
      className="flex-row flex-wrap overflow-hidden"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {tints === undefined
        ? paths
            .slice(0, 4)
            .map((path) => <Artwork key={path} uri={uri(path, ytMusic)} size={half} />)
        : tints.slice(0, 4).map((tint, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- a fixed 2×2 grid
            <Artwork key={i} tint={tint} size={half} />
          ))}
    </View>
  );
}
