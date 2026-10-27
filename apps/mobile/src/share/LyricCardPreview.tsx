import { Canvas, LinearGradient, Rect, vec } from "@shopify/react-native-skia";
import {
  LYRIC_CARD_FALLBACK,
  lyricCardFileName,
  lyricStoryFrame,
  lyricStoryBackground,
  nextLyricCardColour,
  type LyricStoryFrame,
  type LyricStoryBackground,
} from "@wave/core";
import { useEffect, useRef, useState } from "react";
import { PixelRatio, StyleSheet, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { addScreenBackHandler } from "@/overlay/back";

import { LyricCard } from "./LyricCardArtwork";
import { closeLyricCard, type LyricCardContent } from "./lyricCard";
import { ShareDestinations } from "./ShareDestinations";
import { SharePreviewFrame } from "./SharePreviewFrame";
import type { ImageSource } from "./shareImage";
import { useImageShare } from "./useImageShare";

const LOG_TAG = "LyricsShare";

/**
 * The exported card's width in pixels, a Story's; its height follows the
 * lines (Core's `lyricCardLayout`), from 1080 (square) to 1920 (9:16).
 */
const EXPORT_PX = 1080;

/** The preview Story's corners; the card's radius comes from the exported framing. */
const PREVIEW_RADIUS = CELL * 2;

/** The card's file name, stamped now. */
const cardFileName = (title: string): string => lyricCardFileName(title, new Date());

/**
 * The solid card as a smaller rounded sticker over its complementary Story.
 * The card view itself stays square for standalone exports; native Stories
 * export crops a separate PNG to the same [frame]'s card size and corners.
 */
function FittedCard({
  content,
  colour,
  background,
  frame,
  area,
  cardRef,
  onReady,
  onPress,
}: {
  content: LyricCardContent;
  colour: string;
  background: LyricStoryBackground;
  frame: LyricStoryFrame;
  area: { width: number; height: number };
  cardRef: ImageSource;
  onReady: () => void;
  onPress: () => void;
}) {
  const storyScale = Math.min(area.width / frame.width, area.height / frame.height);
  const storyWidth = frame.width * storyScale;
  const storyHeight = frame.height * storyScale;
  const width = frame.cardWidth * storyScale;
  const height = frame.cardHeight * storyScale;
  const radius = frame.cornerRadius * storyScale;
  const exportWidth = EXPORT_PX / PixelRatio.get();
  const exportHeight = exportWidth * (frame.cardHeight / frame.cardWidth);
  const scale = width / exportWidth;
  return (
    <View
      style={{
        width: storyWidth,
        height: storyHeight,
        borderRadius: PREVIEW_RADIUS,
        overflow: "hidden",
      }}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={storyWidth} height={storyHeight}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, storyHeight)}
            colors={[background.top, background.bottom]}
          />
        </Rect>
      </Canvas>
      <Press
        accessibilityRole="button"
        accessibilityLabel="Lyrics card"
        accessibilityHint="Changes the card's colour"
        onPress={onPress}
        haptic="selection"
        depth={0.02}
        style={{
          position: "absolute",
          left: frame.left * storyScale,
          top: frame.top * storyScale,
          width,
          height,
          borderRadius: radius,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            position: "absolute",
            left: (width - exportWidth) / 2,
            top: (height - exportHeight) / 2,
            transform: [{ scale }],
          }}
        >
          <LyricCard
            ref={cardRef}
            content={content}
            colour={colour}
            width={exportWidth}
            onReady={onReady}
          />
        </View>
      </Press>
    </View>
  );
}

/**
 * The card's preview over Now Playing, after Next: tap the card to cycle its
 * colours, then save it or share it from the destinations row. Close (or
 * Back) goes back to picking lines.
 */
export function LyricCardPreview({ content }: { content: LyricCardContent }) {
  const [colour, setColour] = useState(content.colours[0] ?? LYRIC_CARD_FALLBACK);
  // A cover still loading would be missing from the image.
  const [ready, setReady] = useState(content.artworkUri === undefined);
  const card: ImageSource = useRef(null);
  const background = lyricStoryBackground(colour);
  const frame = lyricStoryFrame(content.lines);

  useEffect(
    () =>
      addScreenBackHandler(() => {
        closeLyricCard();
        return true;
      }),
    [],
  );

  const share = useImageShare({
    source: card,
    fileName: () => cardFileName(content.title),
    what: "the lyrics card",
    sheetTitle: "Share Lyrics",
    logTag: LOG_TAG,
    storyBackground: background,
    storyFrame: frame,
  });

  return (
    <SharePreviewFrame
      onClose={closeLyricCard}
      renderPreview={(area) => (
        <FittedCard
          content={content}
          colour={colour}
          background={background}
          frame={frame}
          area={area}
          cardRef={card}
          onReady={() => setReady(true)}
          onPress={() => setColour((current) => nextLyricCardColour(content.colours, current))}
        />
      )}
    >
      <Text
        className="text-center font-sans text-footnote text-secondary"
        style={{ marginBottom: CELL * 3 }}
      >
        {content.colours.length > 1 ? "Tap the card to change its colour" : " "}
      </Text>
      {/* Hidden, not left out, until some answer is known: the row's height stays and the card doesn't jump. */}
      <View style={{ opacity: share.known ? 1 : 0 }}>
        <ShareDestinations destinations={share.destinations} disabled={share.disabled || !ready} />
      </View>
    </SharePreviewFrame>
  );
}
