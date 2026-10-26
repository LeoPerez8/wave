import { IconMusic } from "@tabler/icons-react-native";
import { withOpacity, type SongCardColours } from "@wave/core";
import type { ComponentRef, Ref } from "react";
import { Image, Text, View } from "react-native";

import { WaveMark } from "./LyricCardArtwork";
import type { SongShareContent } from "./songShare";

/** The card's height as a multiple of its width: the square cover, the title, artist and mark. */
export const SONG_CARD_ASPECT = 1.4;

type Props = {
  readonly content: SongShareContent;
  /** Its background and ink (Core's `songCardColours`). */
  readonly colours: SongCardColours;
  /** The card's width in dp; its height is [SONG_CARD_ASPECT] times it, everything scaling with it. */
  readonly width: number;
  /** Rounds the card's corners (the sticker); square by default. */
  readonly cornerRadius?: number;
  /** Called once the cover has loaded (or failed to), so a snapshot has it. */
  readonly onReady?: () => void;
  /** For drawing the card into an image (`writeViewPng`). */
  readonly ref?: Ref<ComponentRef<typeof View>>;
};

/**
 * A song's card (docs/spec.md, "Sharing a song"): the cover large, the title
 * and artist under it, and a discreet Wave mark, on the card's colour. Text
 * ignores the font scale, so the card is the same image on every phone. Its
 * cover is React Native's `Image`, whose bitmaps the snapshot's software
 * canvas can draw.
 */
export function SongCard({ content, colours, width, cornerRadius = 0, onReady, ref }: Props) {
  const unit = width / 100;
  const { card, ink } = colours;
  const faded = withOpacity(ink, 0.72);
  const cover = width - unit * 14;
  return (
    <View
      ref={ref}
      collapsable={false}
      style={{
        width,
        height: width * SONG_CARD_ASPECT,
        padding: unit * 7,
        backgroundColor: card,
        borderRadius: cornerRadius,
        overflow: "hidden",
      }}
    >
      {content.artworkUri === undefined ? (
        <View
          className="items-center justify-center"
          style={{
            width: cover,
            height: cover,
            borderRadius: unit * 2.5,
            backgroundColor: withOpacity(ink, 0.16),
          }}
        >
          <IconMusic size={cover / 3} color={faded} strokeWidth={1.25} />
        </View>
      ) : (
        <Image
          // A new cover (YouTube's, then the cached file) loads afresh.
          key={content.artworkUri}
          source={{ uri: content.artworkUri }}
          onLoadEnd={onReady}
          style={{ width: cover, height: cover, borderRadius: unit * 2.5 }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      )}
      <Text
        allowFontScaling={false}
        numberOfLines={2}
        className="font-sans font-bold"
        style={{
          color: ink,
          fontSize: unit * 6.4,
          lineHeight: unit * 7.8,
          letterSpacing: -unit * 0.06,
          marginTop: unit * 5,
        }}
      >
        {content.title}
      </Text>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        className="font-sans font-medium"
        style={{ color: faded, fontSize: unit * 5, lineHeight: unit * 6.6 }}
      >
        {content.artist}
      </Text>
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
