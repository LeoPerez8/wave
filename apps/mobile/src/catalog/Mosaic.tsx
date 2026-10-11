import { View } from "react-native";

import { Artwork } from "./Artwork";

type Props = {
  /** Cached artwork files from Core's `playlistMosaic`: none, one, or four. */
  paths: readonly string[];
  size: number;
};

const uri = (path: string | undefined): string | undefined =>
  path === undefined ? undefined : `file://${path}`;

/**
 * A playlist's artwork: four album covers in a 2×2 square, butted together
 * with no gutter or frame, or a single cover when there are fewer than four.
 */
export function Mosaic({ paths, size }: Props) {
  if (paths.length < 4) return <Artwork uri={uri(paths[0])} size={size} />;
  const half = size / 2;
  return (
    <View
      accessibilityIgnoresInvertColors
      className="flex-row flex-wrap"
      style={{ width: size, height: size }}
    >
      {paths.slice(0, 4).map((path) => (
        <Artwork key={path} uri={uri(path)} size={half} />
      ))}
    </View>
  );
}
