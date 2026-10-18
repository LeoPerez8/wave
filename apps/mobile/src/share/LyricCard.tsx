import { IconMusic } from "@tabler/icons-react-native";
import {
  LYRIC_CARD_LAYOUT,
  logoIconPaths,
  lyricCardInk,
  lyricCardTextSize,
  withOpacity,
} from "@wave/core";
import type { ComponentRef, Ref } from "react";
import { Image, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { LyricCardContent } from "./lyricCard";

type Props = {
  readonly content: LyricCardContent;
  /** The background, one of `content.colours`; the text picks its ink for contrast with it. */
  readonly colour: string;
  /** The card's width in dp; its height is 16/9 of it and everything inside scales with it. */
  readonly width: number;
  /** Rounds the card's corners (a sticker); square, full-bleed, by default. */
  readonly cornerRadius?: number;
  /** Called once the cover has loaded (or failed to), so a snapshot has it. */
  readonly onReady?: () => void;
  /** For drawing the card into an image (`writeViewPng`). */
  readonly ref?: Ref<ComponentRef<typeof View>>;
};

/** Wave's logo, its two waves stroked in [colour], in a [size] square. */
function WaveMark({ size, colour }: { size: number; colour: string }) {
  const paths = logoIconPaths({ size, inset: 0 });
  return (
    <Svg width={size} height={size}>
      {[paths.top, paths.bottom].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={colour}
          strokeWidth={paths.stroke}
          strokeLinecap="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}

/**
 * The lyrics card (docs/spec.md, "Sharing lyrics"): 9:16, solid in the chosen
 * colour, the cover with the title and artist at the top, the lines large and
 * bold below, and a discreet Wave mark. Text ignores the font scale, so the
 * card is the same image on every phone. Its cover is React Native's `Image`,
 * whose bitmaps the snapshot's software canvas can draw.
 */
export function LyricCard({ content, colour, width, cornerRadius = 0, onReady, ref }: Props) {
  const { margin, lineHeight, aspect } = LYRIC_CARD_LAYOUT;
  const ink = lyricCardInk(colour);
  const faded = withOpacity(ink, 0.72);
  const unit = width / 100;
  const cover = unit * 15;
  const textSize = lyricCardTextSize(content.lines) * width;

  return (
    <View
      ref={ref}
      collapsable={false}
      style={{
        width,
        height: width * aspect,
        padding: width * margin,
        backgroundColor: colour,
        borderRadius: cornerRadius,
        overflow: "hidden",
      }}
    >
      <View className="flex-row items-center" style={{ gap: unit * 3.5 }}>
        {content.artworkUri === undefined ? (
          <View
            className="items-center justify-center"
            style={{
              width: cover,
              height: cover,
              borderRadius: unit * 1.5,
              backgroundColor: withOpacity(ink, 0.16),
            }}
          >
            <IconMusic size={cover / 2.5} color={faded} strokeWidth={1.5} />
          </View>
        ) : (
          <Image
            source={{ uri: content.artworkUri }}
            onLoadEnd={onReady}
            style={{ width: cover, height: cover, borderRadius: unit * 1.5 }}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        )}
        <View className="flex-1">
          <Text
            allowFontScaling={false}
            numberOfLines={2}
            className="font-sans font-bold"
            style={{ color: ink, fontSize: unit * 4.6, lineHeight: unit * 5.8 }}
          >
            {content.title}
          </Text>
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            className="font-sans font-medium"
            style={{ color: faded, fontSize: unit * 4, lineHeight: unit * 5.4 }}
          >
            {content.artist}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: unit * 9, gap: textSize * 0.3 }}>
        {content.lines.map((line, at) => (
          <Text
            // Lines never reorder while the card shows.
            key={at}
            allowFontScaling={false}
            className="font-sans font-bold"
            style={{
              color: ink,
              fontSize: textSize,
              lineHeight: textSize * lineHeight,
              letterSpacing: -textSize * 0.01,
            }}
          >
            {line}
          </Text>
        ))}
      </View>

      <View className="flex-1" />
      <View className="flex-row items-center" style={{ gap: unit * 1.5 }}>
        <WaveMark size={unit * 6} colour={faded} />
        <Text
          allowFontScaling={false}
          className="font-sans font-semibold"
          style={{ color: faded, fontSize: unit * 3.6 }}
        >
          Wave
        </Text>
      </View>
    </View>
  );
}
