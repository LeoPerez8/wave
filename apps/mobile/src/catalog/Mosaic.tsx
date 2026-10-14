import { View } from "react-native";

import { useYtMusicEnabled } from "@/settings/ytMusic";

import { Artwork } from "./Artwork";

type Props = {
  /**
   * Covers from Core's `playlistMosaic`: none, one, or four. Each a cached
   * artwork file, or a YT Music entry's cover address.
   */
  paths: readonly string[];
  size: number;
};

const ADDRESS = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Where [path] loads from: a cached file, or a YT Music entry's cover address,
 * only while YT Music is on (off, Wave asks YouTube for nothing, so the
 * placeholder shows instead).
 */
const uri = (path: string | undefined, ytMusic: boolean): string | undefined => {
  if (path === undefined) return undefined;
  if (!ADDRESS.test(path)) return `file://${path}`;
  return ytMusic ? path : undefined;
};

/**
 * A playlist's artwork: four album covers in a 2×2 square, butted together
 * with no gutter or frame, or a single cover when there are fewer than four.
 */
export function Mosaic({ paths, size }: Props) {
  const ytMusic = useYtMusicEnabled();
  if (paths.length < 4) return <Artwork uri={uri(paths[0], ytMusic)} size={size} />;
  const half = size / 2;
  return (
    <View
      accessibilityIgnoresInvertColors
      className="flex-row flex-wrap"
      style={{ width: size, height: size }}
    >
      {paths.slice(0, 4).map((path) => (
        <Artwork key={path} uri={uri(path, ytMusic)} size={half} />
      ))}
    </View>
  );
}
