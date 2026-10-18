import { IconDots, IconPhotoDown, IconX } from "@tabler/icons-react-native";
import {
  LYRIC_CARD_FALLBACK,
  LYRIC_CARD_LAYOUT,
  lyricCardFileName,
  nextLyricCardColour,
} from "@wave/core";
import { useEffect, useRef, useState } from "react";
import { PixelRatio, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { appLog } from "@/log/appLog";
import { Press } from "@/motion/Press";
import { addScreenBackHandler } from "@/overlay/back";
import { showToast } from "@/overlay/toast";

import { LyricCard } from "./LyricCard";
import { closeLyricCard, useLyricCard, type LyricCardContent } from "./lyricCard";
import { ShareDestinations, type ShareDestination } from "./ShareDestinations";
import {
  openImageShareSheet,
  saveImageToGallery,
  writeViewPng,
  type ImageSource,
} from "./shareImage";

const LOG_TAG = "LyricsShare";

/** The exported card's width in pixels: a Story's (1080 × 1920). */
const EXPORT_PX = 1080;

/** The preview's rounded corners, which the exported image doesn't have. */
const PREVIEW_RADIUS = CELL * 2;

/**
 * The card, fitted into [size] and drawn at the export's size scaled down, so
 * what's previewed is the very view that becomes the image.
 */
function FittedCard({
  content,
  colour,
  area,
  cardRef,
  onReady,
  onPress,
}: {
  content: LyricCardContent;
  colour: string;
  area: { width: number; height: number };
  cardRef: ImageSource;
  onReady: () => void;
  onPress: () => void;
}) {
  const exportWidth = EXPORT_PX / PixelRatio.get();
  const exportHeight = exportWidth * LYRIC_CARD_LAYOUT.aspect;
  const width = Math.min(area.width, area.height / LYRIC_CARD_LAYOUT.aspect);
  const height = width * LYRIC_CARD_LAYOUT.aspect;
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
  const insets = useSafeAreaInsets();
  const [colour, setColour] = useState(content.colours[0] ?? LYRIC_CARD_FALLBACK);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  // A cover still loading would be missing from the image.
  const [ready, setReady] = useState(content.artworkUri === undefined);
  const [busy, setBusy] = useState(false);
  const card: ImageSource = useRef(null);

  useEffect(
    () =>
      addScreenBackHandler(() => {
        closeLyricCard();
        return true;
      }),
    [],
  );

  /** Draws the card into a PNG, then hands it to [send]; one at a time. */
  const sendCard = async (
    what: string,
    send: (path: string) => Promise<void>,
    failed: string,
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const path = await writeViewPng(card, lyricCardFileName(content.title, new Date()));
      await send(path);
    } catch (error) {
      appLog("warn", LOG_TAG, `Couldn't ${what}: ${String(error)}`);
      void showToast(failed);
    } finally {
      setBusy(false);
    }
  };

  const destinations: ShareDestination[] = [
    {
      key: "save",
      label: "Save image",
      icon: IconPhotoDown,
      onPress: () =>
        void sendCard(
          "save the lyrics card",
          async (path) => {
            await saveImageToGallery(path);
            void showToast("Saved to your gallery");
          },
          "Couldn't save the image",
        ),
    },
    {
      key: "more",
      label: "More",
      icon: IconDots,
      onPress: () =>
        void sendCard(
          "share the lyrics card",
          (path) => openImageShareSheet(path, "Share Lyrics"),
          "Couldn't share the image",
        ),
    },
  ];

  return (
    <View
      className="bg-background"
      style={[
        StyleSheet.absoluteFill,
        { paddingTop: insets.top, paddingBottom: insets.bottom + CELL * 3 },
      ]}
    >
      <View
        className="flex-row items-center"
        style={{ height: CELL * 7, paddingHorizontal: grid.margin - 12 }}
      >
        <IconButton icon={IconX} label="Close" onPress={closeLyricCard} />
      </View>
      <View
        className="flex-1 items-center justify-center"
        style={{ paddingHorizontal: grid.margin * 2, paddingVertical: CELL * 2 }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setArea({ width: width - grid.margin * 4, height: height - CELL * 4 });
        }}
      >
        {area !== null && area.width > 0 && area.height > 0 && (
          <FittedCard
            content={content}
            colour={colour}
            area={area}
            cardRef={card}
            onReady={() => setReady(true)}
            onPress={() => setColour((current) => nextLyricCardColour(content.colours, current))}
          />
        )}
      </View>
      <Text
        className="text-center font-sans text-footnote text-secondary"
        style={{ marginBottom: CELL * 3 }}
      >
        {content.colours.length > 1 ? "Tap the card to change its colour" : " "}
      </Text>
      <ShareDestinations destinations={destinations} disabled={busy || !ready} />
    </View>
  );
}

/** The lyrics card's preview while one is open (`openLyricCard`), over Now Playing. */
export function LyricCardLayer() {
  const content = useLyricCard();
  return content === null ? null : <LyricCardPreview content={content} />;
}
