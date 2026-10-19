import {
  LYRIC_CARD_FALLBACK,
  lyricCardFileName,
  lyricCardLayout,
  lyricStoryBackground,
  nextLyricCardColour,
} from "@wave/core";
import { useEffect, useRef, useState } from "react";
import { PixelRatio, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { addScreenBackHandler } from "@/overlay/back";

import { LyricCard } from "./LyricCard";
import { closeLyricCard, useLyricCard, type LyricCardContent } from "./lyricCard";
import { ShareDestinations } from "./ShareDestinations";
import { SharePreviewFrame } from "./SharePreviewFrame";
import type { ImageSource } from "./shareImage";
import { useDrawingCorners, useImageShare } from "./useImageShare";

const LOG_TAG = "LyricsShare";

/**
 * The exported card's width in pixels, a Story's; its height follows the
 * lines (Core's `lyricCardLayout`), from 1080 (square) to 1920 (9:16).
 */
const EXPORT_PX = 1080;

/**
 * The preview's rounded corners. Save image and More export the card square;
 * Instagram's sticker is exported with these same corners, as it's previewed.
 */
const PREVIEW_RADIUS = CELL * 2;

/** The card's file name, stamped now. */
const cardFileName = (title: string): string => lyricCardFileName(title, new Date());

/**
 * The card, fitted into [area] in its own shape and drawn at the export's size
 * scaled down, so what's previewed is the very view that becomes the image.
 */
function FittedCard({
  content,
  colour,
  area,
  cardRef,
  rounded,
  onReady,
  onPress,
}: {
  content: LyricCardContent;
  colour: string;
  area: { width: number; height: number };
  cardRef: ImageSource;
  /** Whether the card itself takes the preview's corners (drawing Instagram's sticker). */
  rounded: boolean;
  onReady: () => void;
  onPress: () => void;
}) {
  const { aspect } = lyricCardLayout(content.lines);
  const exportWidth = EXPORT_PX / PixelRatio.get();
  const exportHeight = exportWidth * aspect;
  const width = Math.min(area.width, area.height / aspect);
  const height = width * aspect;
  const scale = width / exportWidth;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel="Lyrics card"
      accessibilityHint="Changes the card's colour"
      onPress={onPress}
      haptic="selection"
      depth={0.02}
      style={{ width, height, borderRadius: PREVIEW_RADIUS, overflow: "hidden" }}
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
          cornerRadius={rounded ? PREVIEW_RADIUS / scale : 0}
          onReady={onReady}
        />
      </View>
    </Press>
  );
}

/**
 * The card's preview over Now Playing, after Next: tap the card to cycle its
 * colours, then save it or share it from the destinations row. Close (or
 * Back) goes back to picking lines.
 */
function LyricCardPreview({ content }: { content: LyricCardContent }) {
  const [colour, setColour] = useState(content.colours[0] ?? LYRIC_CARD_FALLBACK);
  // A cover still loading would be missing from the image.
  const [ready, setReady] = useState(content.artworkUri === undefined);
  const card: ImageSource = useRef(null);
  // Instagram's sticker is drawn from the card with the preview's corners, then squared again.
  const corners = useDrawingCorners();

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
    storyBackground: lyricStoryBackground(colour),
    prepare: (destination) =>
      destination === "instagramStories" ? corners.startDrawing() : Promise.resolve(),
    afterDraw: corners.endDrawing,
  });

  return (
    <SharePreviewFrame
      onClose={closeLyricCard}
      renderPreview={(area) => (
        <FittedCard
          content={content}
          colour={colour}
          area={area}
          cardRef={card}
          rounded={corners.drawing}
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

/** The lyrics card's preview while one is open (`openLyricCard`), over Now Playing. */
export function LyricCardLayer() {
  const content = useLyricCard();
  return content === null ? null : <LyricCardPreview content={content} />;
}
