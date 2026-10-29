import { useLocalisation } from "@/localisation/localisation";
import { recapCardFileName, recapStoryBackground } from "@wave/core";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PixelRatio, Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { addScreenBackHandler } from "@/overlay/back";
import { ImageCaptureContext, type ImageCapture } from "@/share/imageCapture";
import { WaveMark } from "@/share/LyricCardArtwork";
import { ShareDestinations } from "@/share/ShareDestinations";
import { SharePreviewFrame } from "@/share/SharePreviewFrame";
import type { ImageSource } from "@/share/shareImage";
import { useImageShare } from "@/share/useImageShare";
import { useThemeColor } from "@/theme/useThemeColor";

const LOG_TAG = "RecapShare";

/** The exported image's size in pixels: a Story's, 9:16. */
const EXPORT_WIDTH_PX = 1080;
const EXPORT_ASPECT = 16 / 9;

/**
 * A slide as a 9:16 image: the slide on its colour, the Recap's title at the
 * top and Wave's mark at the bottom. `children` is the slide, drawn still
 * (no entrances) with images the snapshot can draw.
 */
function RecapImage({
  title,
  colour,
  width,
  imageRef,
  onLayout,
  children,
}: {
  title: string;
  colour: string;
  width: number;
  imageRef: ImageSource;
  onLayout: () => void;
  children: ReactNode;
}) {
const localisation = useLocalisation();

  const unit = width / 100;
  const ink = useThemeColor("on-recap");
  return (
    <View
      ref={imageRef}
      collapsable={false}
      onLayout={onLayout}
      style={{
        width,
        height: width * EXPORT_ASPECT,
        backgroundColor: colour,
        paddingHorizontal: grid.margin,
        paddingTop: CELL * 4,
        paddingBottom: CELL * 3,
      }}
    >
      <Text numberOfLines={1} className="font-sans text-subheadline font-semibold text-on-recap">
        {title} · {localisation.strings.home.recap}
      </Text>
      <View className="flex-1" style={{ paddingVertical: CELL * 2 }}>
        {children}
      </View>
      <View className="flex-row items-center" style={{ gap: unit * 1.5 }}>
        <WaveMark size={unit * 6} colour={ink} />
        <Text
          allowFontScaling={false}
          className="font-sans font-semibold text-on-recap"
          style={{ fontSize: unit * 3.6 }}
        >
          Wave
        </Text>
      </View>
    </View>
  );
}

/**
 * Sharing a Recap slide: a preview of the slide as a 9:16 image over the
 * stories, and the share destinations under it (the lyrics card's: Instagram
 * Stories, WhatsApp, Save image, More). Close or Back returns to the stories.
 */
export function RecapSharePreview({
  title,
  colour,
  onClose,
  children,
}: {
  /** The Recap's title: "September 2026". */
  title: string;
  /** The slide's colour, `#rrggbb`: the image's background and the Instagram story's. */
  colour: string;
  onClose: () => void;
  /** The slide to share. */
  children: ReactNode;
}) {
 const localisation = useLocalisation();

  const image: ImageSource = useRef(null);
  // The slide's images report in: the image waits for every one of them.
  const [pending, setPending] = useState(0);
  // Laid out after its images have registered: until then, none pending means none known yet.
  const [laidOut, setLaidOut] = useState(false);
  const capture = useMemo<ImageCapture>(
    () => ({ add: () => setPending((n) => n + 1), settle: () => setPending((n) => n - 1) }),
    [],
  );

  useEffect(
    () =>
      addScreenBackHandler(() => {
        onClose();
        return true;
      }),
    [onClose],
  );

  const share = useImageShare({
    source: image,
    fileName: () => recapCardFileName(title, new Date()),
    what: "the Recap slide",
    sheetTitle: localisation.strings.home.shareRecap,
    logTag: LOG_TAG,
    storyBackground: recapStoryBackground(colour),
  });

  const exportWidth = EXPORT_WIDTH_PX / PixelRatio.get();

  return (
    <SharePreviewFrame
      onClose={onClose}
      renderPreview={(area) => {
        const fitted = Math.min(area.width, area.height / EXPORT_ASPECT);
        // The image is drawn at the export's size and scaled down, so what's previewed is it.
        return (
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={localisation.strings.home.recapSlide(title)}
            style={{
              width: fitted,
              height: fitted * EXPORT_ASPECT,
              borderRadius: CELL * 2,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                position: "absolute",
                left: (fitted - exportWidth) / 2,
                top: (fitted - exportWidth) * (EXPORT_ASPECT / 2),
                transform: [{ scale: fitted / exportWidth }],
              }}
            >
              <ImageCaptureContext.Provider value={capture}>
                <RecapImage
                  title={title}
                  colour={colour}
                  width={exportWidth}
                  imageRef={image}
                  onLayout={() => setLaidOut(true)}
                >
                  {children}
                </RecapImage>
              </ImageCaptureContext.Provider>
            </View>
          </View>
        );
      }}
    >
      <StatusBar style="auto" />
      {/* Hidden, not left out, until some answer is known: the row's height stays. */}
      <View style={{ opacity: share.known ? 1 : 0, marginTop: CELL * 3 }}>
        <ShareDestinations
          destinations={share.destinations}
          disabled={share.disabled || !laidOut || pending > 0}
        />
      </View>
    </SharePreviewFrame>
  );
}
