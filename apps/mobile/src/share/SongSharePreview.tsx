import { Canvas, LinearGradient, Rect, vec } from "@shopify/react-native-skia";
import { IconBrandSpotify, IconBrandYoutube, IconLink } from "@tabler/icons-react-native";
import {
  songCardColours,
  songCardFileName,
  songLinkView,
  songShareDestinations,
  SONG_LINKS_LOADING,
  type LyricStoryBackground,
  type SongLinkOption,
  type SongLinksState,
} from "@wave/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Share, StyleSheet, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { appLog } from "@/log/appLog";
import { WaveNative } from "@/native/waveNative";
import { addScreenBackHandler } from "@/overlay/back";
import { showToast } from "@/overlay/toast";

import { ShareDestinations, type ShareDestination } from "./ShareDestinations";
import { SharePreviewFrame } from "./SharePreviewFrame";
import type { ImageSource } from "./shareImage";
import { SONG_CARD_ASPECT, SongCard } from "./SongCard";
import { closeSongShare, useSongShare, type SongShareContent } from "./songShare";
import { useDrawingCorners, useImageShare } from "./useImageShare";

const LOG_TAG = "SongShare";

/** The exported card's width in pixels: a Story's width. */
const EXPORT_PX = 1080;

/** A Story's shape (9:16): the preview shows the card as a sticker on one. */
const STORY_ASPECT = 16 / 9;

/** How much of the Story's width the sticker takes in the preview. */
const STICKER_SHARE = 0.68;

/** The preview's rounded corners, the Story's and the sticker's (exported with Instagram's). */
const PREVIEW_RADIUS = CELL * 2;

/** The card's file name, stamped now. */
const cardFileName = (title: string): string => songCardFileName(title, new Date());

const LINK_LABELS: Record<SongLinkOption, string> = {
  copyLink: "Copy Link",
  spotify: "Spotify",
  ytMusic: "YT Music",
};

const LINK_ICONS: Record<SongLinkOption, ShareDestination["icon"]> = {
  copyLink: IconLink,
  spotify: IconBrandSpotify,
  ytMusic: IconBrandYoutube,
};

/** Copies [url] (song.link's page) and says so. */
const copyLink = async (url: string): Promise<void> => {
  try {
    await WaveNative.writeClipboardText("Song link", url);
    void showToast("Link copied");
  } catch (error) {
    appLog("warn", LOG_TAG, `Couldn't copy the song's link: ${String(error)}`);
    void showToast("Couldn't copy the link");
  }
};

/** Opens Android's share sheet with [url], the song's link on [title]'s platform. */
const shareLink = async (url: string, title: string): Promise<void> => {
  try {
    await Share.share({ message: url, title });
  } catch (error) {
    appLog("warn", LOG_TAG, `Couldn't share the song's link: ${String(error)}`);
    void showToast("Couldn't share the link");
  }
};

/** The link [option] as a destination while the song's links are [state] (Core's `songLinkView`). */
const linkDestination = (option: SongLinkOption, state: SongLinksState): ShareDestination => {
  const { url, loading, note } = songLinkView(option, state);
  const label = LINK_LABELS[option];
  return {
    key: option,
    label,
    icon: LINK_ICONS[option],
    disabled: url === null,
    loading,
    note,
    onPress: () => {
      if (url === null) return;
      void (option === "copyLink" ? copyLink(url) : shareLink(url, label));
    },
  };
};

/** The Story's ground: [story]'s colours top to bottom, as Instagram draws them. */
function StoryGround({
  story,
  width,
  height,
}: {
  story: LyricStoryBackground;
  width: number;
  height: number;
}) {
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={[story.top, story.bottom]} />
      </Rect>
    </Canvas>
  );
}

/**
 * The song share sheet (docs/spec.md, "Sharing a song"): the card as a
 * sticker on a Story in the cover's colours, and the destinations row under
 * it. Close (or Back) closes it.
 */
function SongSharePreview({ content }: { content: SongShareContent }) {
  const colours = useMemo(() => songCardColours(content.palette), [content.palette]);
  // A cover still loading would be missing from the image.
  const [loaded, setLoaded] = useState<string | undefined>(undefined);
  const ready = content.artworkUri === undefined || loaded === content.artworkUri;
  const card: ImageSource = useRef(null);
  // The sticker keeps the preview's corners; WhatsApp and More get the card square.
  const square = useDrawingCorners();

  useEffect(
    () =>
      addScreenBackHandler(() => {
        closeSongShare();
        return true;
      }),
    [],
  );

  const links = content.links;
  const share = useImageShare({
    source: card,
    fileName: () => cardFileName(content.title),
    what: "the song",
    sheetTitle: "Share Song",
    logTag: LOG_TAG,
    storyBackground: colours.story,
    prepare: (destination) =>
      destination === "instagramStories" ? Promise.resolve() : square.startDrawing(),
    afterDraw: square.endDrawing,
  });
  const destinations = songShareDestinations(share.apps, { links: links !== null }).map((key) =>
    key === "copyLink" || key === "spotify" || key === "ytMusic"
      ? linkDestination(key, links ?? SONG_LINKS_LOADING)
      : share.image[key],
  );

  const exportWidth = EXPORT_PX / PixelRatio.get();

  return (
    <SharePreviewFrame
      onClose={closeSongShare}
      renderPreview={(area) => {
        // The Story fitted into the area; the card laid out at the export's size, scaled down onto it.
        const storyWidth = Math.min(area.width, area.height / STORY_ASPECT);
        const storyHeight = storyWidth * STORY_ASPECT;
        const stickerWidth = storyWidth * STICKER_SHARE;
        const scale = exportWidth === 0 ? 1 : stickerWidth / exportWidth;
        return (
          <View
            accessible
            accessibilityLabel={`${content.title}, ${content.artist}`}
            className="items-center justify-center"
            style={{
              width: storyWidth,
              height: storyHeight,
              borderRadius: PREVIEW_RADIUS,
              overflow: "hidden",
            }}
          >
            <StoryGround story={colours.story} width={storyWidth} height={storyHeight} />
            <View style={{ width: stickerWidth, height: stickerWidth * SONG_CARD_ASPECT }}>
              <View
                style={{
                  position: "absolute",
                  left: (stickerWidth - exportWidth) / 2,
                  top: ((stickerWidth - exportWidth) * SONG_CARD_ASPECT) / 2,
                  transform: [{ scale }],
                }}
              >
                <SongCard
                  ref={card}
                  content={content}
                  colours={colours}
                  width={exportWidth}
                  cornerRadius={square.drawing ? 0 : PREVIEW_RADIUS / scale}
                  onReady={() => setLoaded(content.artworkUri)}
                />
              </View>
            </View>
          </View>
        );
      }}
    >
      {/* Hidden, not left out, until some answer is known: the row's height stays. */}
      <View style={{ opacity: share.known ? 1 : 0, marginTop: CELL * 2 }}>
        <ShareDestinations destinations={destinations} disabled={share.disabled || !ready} />
      </View>
    </SharePreviewFrame>
  );
}

/** The song share sheet while one is open (`openSongShare`), over Now Playing and the app. */
export function SongShareLayer() {
  const content = useSongShare();
  return content === null ? null : <SongSharePreview content={content} />;
}
