import { artistInitial } from "@wave/core";
import { IconUser } from "@tabler/icons-react-native";
import { Image } from "expo-image";
import { Text, View } from "react-native";

import { useArtistPhoto } from "@/library/artistPhotos";
import { useThemeColor } from "@/theme/useThemeColor";

/** What an artist image needs: the artist's name and image (see `ArtistRow`). */
export interface ArtistImageSource {
  readonly name: string;
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
  /** An image online (a YouTube Music artist's), shown when there's no file. */
  readonly imageUrl?: string | null | undefined;
}

type Props = {
  artist: ArtistImageSource;
  size: number;
  /** Full-size image (the artist page); rows and menus use the thumbnail. */
  large?: boolean;
};

/**
 * An artist, as a circle (the one round image in the catalog, so artists read
 * apart from albums): their downloaded photo, else their album-artwork image,
 * else their initial on a tinted field.
 */
export function ArtistImage({ artist, size, large = false }: Props) {
  const secondary = useThemeColor("secondary");
  const fill = useThemeColor("fill");
  const photo = useArtistPhoto(artist.name);
  const path = large
    ? (photo?.path ?? artist.artworkPath ?? artist.thumbPath)
    : (photo?.thumbPath ?? artist.thumbPath);
  const uri = path === null ? (artist.imageUrl ?? null) : `file://${path}`;
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (uri !== null) {
    return (
      <Image
        source={{ uri }}
        // List rows are recycled; the key stops the previous artist's image flashing.
        recyclingKey={uri}
        style={[circle, { backgroundColor: fill }]}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }
  const initial = artistInitial(artist.name);
  return (
    <View className="items-center justify-center overflow-hidden bg-fill" style={circle}>
      {initial === "" ? (
        <IconUser size={size / 3} color={secondary} strokeWidth={1.25} />
      ) : (
        <Text
          className="font-sans font-light text-secondary"
          style={{ fontSize: size * 0.42, lineHeight: size * 0.52 }}
          allowFontScaling={false}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}
