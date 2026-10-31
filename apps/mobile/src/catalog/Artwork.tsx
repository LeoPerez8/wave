import { IconMusic } from "@tabler/icons-react-native";
import { sizedCoverUrls } from "@wave/core";
import { Image } from "expo-image";
import { useState } from "react";
import { Image as SoftwareImage, PixelRatio, StyleSheet, View } from "react-native";

import { artworkUri } from "./artworkUri";
import { useCapturedImage, useInCapture } from "@/share/imageCapture";
import { useThemeColor } from "@/theme/useThemeColor";

type Props = {
  /** Cached path or artwork URI; absent for files without embedded art. */
  uri?: string | undefined;
  /** Solid field shown instead of an image (synthetic preview covers). */
  tint?: string | undefined;
  size: number;
  /** Corner radius, for art set inside a rounded container; square by default. */
  radius?: number | undefined;
  /** Ask for a stored online cover at the size it shows (Core's `sizedCoverUrls`). */
  sharp?: boolean | undefined;
};

/**
 * A sharper address of a cover, over the stored one: each of [addresses] in
 * turn until one loads, so a missing one uncovers nothing but the stored cover.
 */
function SharpCover({ addresses, radius }: { addresses: readonly string[]; radius: number }) {
  const [failed, setFailed] = useState(0);
  const uri = addresses[failed];
  if (uri === undefined) return null;
  return (
    <Image
      source={{ uri }}
      recyclingKey={uri}
      onError={() => setFailed((count) => count + 1)}
      style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      contentFit="cover"
      accessibilityIgnoresInvertColors
    />
  );
}

/** Album art, treated as a photograph: square, no frame, no rounding unless asked. */
export function Artwork({ uri: input, tint, size, radius = 0, sharp = false }: Props) {
  const [tertiary, fill] = useThemeColor(["tertiary", "fill"]);
  const inCapture = useInCapture();
  const pixels = PixelRatio.getPixelSizeForLayoutSize(size);
  const uri = artworkUri(input, inCapture ? "original" : pixels);
  const captured = useCapturedImage(uri);
  if (uri !== undefined && captured !== undefined) {
    // Drawn into a shared image: a bitmap the snapshot's software canvas can draw.
    return (
      <SoftwareImage
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: fill }}
        resizeMode="cover"
        onLoadEnd={captured}
        accessibilityIgnoresInvertColors
      />
    );
  }
  if (uri !== undefined) {
    const sharper = sharp && !inCapture ? sizedCoverUrls(uri, pixels).slice(0, -1) : [];
    const cover = (
      <Image
        source={{ uri }}
        // A medium URI may serve its original before migration. Never keep that fallback on disk.
        cachePolicy={uri.startsWith("content://") ? "memory" : undefined}
        // List rows are recycled; the key stops the previous track's artwork flashing.
        recyclingKey={uri}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: fill }}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
    );
    if (sharper.length === 0) return cover;
    return (
      <View style={{ width: size, height: size }}>
        {cover}
        {/* Mounted anew per cover: recycled rows don't inherit the failures of another. */}
        <SharpCover key={sharper[0]} addresses={sharper} radius={radius} />
      </View>
    );
  }
  return (
    <View
      className="items-center justify-center bg-fill"
      style={[
        { width: size, height: size, borderRadius: radius },
        tint !== undefined && { backgroundColor: tint },
      ]}
    >
      {tint === undefined && <IconMusic size={size / 4} color={tertiary} strokeWidth={1.25} />}
    </View>
  );
}
