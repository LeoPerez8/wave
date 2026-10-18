import { Canvas, LinearGradient, Rect, vec } from "@shopify/react-native-skia";
import {
  IconBrandInstagram,
  IconBrandSpotify,
  IconBrandWhatsapp,
  IconBrandYoutube,
  IconDots,
  IconLink,
  IconX,
} from "@tabler/icons-react-native";
import {
  songCardColours,
  songCardFileName,
  songLinkView,
  songShareDestinations,
  type LyricShareApps,
  type LyricStoryBackground,
  type SongLinkOption,
  type SongLinksState,
  type SongShareDestination,
} from "@wave/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Share, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { appLog } from "@/log/appLog";
import { WaveNative } from "@/native/waveNative";
import { addScreenBackHandler } from "@/overlay/back";
import { showToast } from "@/overlay/toast";

import { ShareDestinations, type ShareDestination } from "./ShareDestinations";
import {
  imageShareApps,
  openImageShareSheet,
  shareImageToInstagramStory,
  shareImageToWhatsApp,
  writeViewPng,
  type ImageSource,
} from "./shareImage";
import { SONG_CARD_ASPECT, SongCard } from "./SongCard";
import { closeSongShare, useSongShare, type SongShareContent } from "./songShare";

const LOG_TAG = "SongShare";

/** The exported card's width in pixels: a Story's width. */
const EXPORT_PX = 1080;

/** A Story's shape (9:16): the preview shows the card as a sticker on one. */
const STORY_ASPECT = 16 / 9;

/** How much of the Story's width the sticker takes in the preview. */
const STICKER_SHARE = 0.68;

/** The preview's rounded corners, the Story's and the sticker's (exported with Instagram's). */
const PREVIEW_RADIUS = CELL * 2;

const NO_APPS: LyricShareApps = { instagramStories: false, whatsapp: false };

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

/** The apps the last sheet found: the row's layout while the next one checks again. */
let lastApps: LyricShareApps | null = null;

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
  const insets = useSafeAreaInsets();
  const colours = useMemo(() => songCardColours(content.palette), [content.palette]);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  // A cover still loading would be missing from the image.
  const [loaded, setLoaded] = useState<string | undefined>(undefined);
  const ready = content.artworkUri === undefined || loaded === content.artworkUri;
  const [busy, setBusy] = useState(false);
  // Two taps in one frame both see busy false; this sees the first.
  const sending = useRef(false);
  const card: ImageSource = useRef(null);
  // Null until this sheet's own check answers; the last answer lays the row out meanwhile.
  const [apps, setApps] = useState<LyricShareApps | null>(null);
  const [laidOutAs] = useState(lastApps);
  // The sticker keeps the preview's corners; WhatsApp and More get the card square.
  const [square, setSquare] = useState(false);
  const squareDrawn = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!square) return;
    const drawn = squareDrawn.current;
    squareDrawn.current = null;
    // A frame, so the corners reach the native view the image is drawn from.
    requestAnimationFrame(() => drawn?.());
  }, [square]);
  const squareCorners = (): Promise<void> =>
    new Promise((resolve) => {
      squareDrawn.current = resolve;
      setSquare(true);
    });

  useEffect(
    () =>
      addScreenBackHandler(() => {
        closeSongShare();
        return true;
      }),
    [],
  );

  useEffect(() => {
    let live = true;
    void imageShareApps().then((found) => {
      lastApps = found;
      if (live) setApps(found);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Draws the card into a PNG (square unless it's the [sticker]), then hands it to [send]. */
  const sendCard = async (
    what: string,
    send: (path: string) => Promise<void>,
    failed: string,
    { sticker = false }: { readonly sticker?: boolean } = {},
  ): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      if (!sticker) await squareCorners();
      const path = await writeViewPng(card, cardFileName(content.title)).finally(() =>
        setSquare(false),
      );
      await send(path);
    } catch (error) {
      appLog("warn", LOG_TAG, `Couldn't ${what}: ${String(error)}`);
      void showToast(failed);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const links = content.links;
  const all: Record<Exclude<SongShareDestination, SongLinkOption>, ShareDestination> = {
    instagramStories: {
      key: "instagramStories",
      label: "Instagram Stories",
      icon: IconBrandInstagram,
      onPress: () =>
        void sendCard(
          "share the song to Instagram Stories",
          (path) => shareImageToInstagramStory(path, colours.story),
          "Couldn't open Instagram",
          { sticker: true },
        ),
    },
    whatsapp: {
      key: "whatsapp",
      label: "WhatsApp",
      icon: IconBrandWhatsapp,
      onPress: () =>
        void sendCard("share the song to WhatsApp", shareImageToWhatsApp, "Couldn't open WhatsApp"),
    },
    more: {
      key: "more",
      label: "More",
      icon: IconDots,
      onPress: () =>
        void sendCard(
          "share the song",
          (path) => openImageShareSheet(path, "Share Song"),
          "Couldn't share the image",
        ),
    },
  };
  const shown = apps ?? laidOutAs;
  const destinations = songShareDestinations(shown ?? NO_APPS, { links: links !== null }).map(
    (key) =>
      key === "copyLink" || key === "spotify" || key === "ytMusic"
        ? linkDestination(key, links ?? { status: "loading" })
        : all[key],
  );

  // The Story fitted into the area; the card laid out at the export's size, scaled down onto it.
  const storyWidth = area === null ? 0 : Math.min(area.width, area.height / STORY_ASPECT);
  const storyHeight = storyWidth * STORY_ASPECT;
  const stickerWidth = storyWidth * STICKER_SHARE;
  const exportWidth = EXPORT_PX / PixelRatio.get();
  const scale = exportWidth === 0 ? 1 : stickerWidth / exportWidth;

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
        <IconButton icon={IconX} label="Close" onPress={closeSongShare} />
      </View>
      <View
        className="flex-1 items-center justify-center"
        style={{ paddingHorizontal: grid.margin * 2, paddingVertical: CELL * 2 }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setArea({ width: width - grid.margin * 4, height: height - CELL * 4 });
        }}
      >
        {storyWidth > 0 && (
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
                  cornerRadius={square ? 0 : PREVIEW_RADIUS / scale}
                  onReady={() => setLoaded(content.artworkUri)}
                />
              </View>
            </View>
          </View>
        )}
      </View>
      {/* Hidden, not left out, until some answer is known: the row's height stays. */}
      <View style={{ opacity: shown === null ? 0 : 1, marginTop: CELL * 2 }}>
        <ShareDestinations destinations={destinations} disabled={busy || !ready || apps === null} />
      </View>
    </View>
  );
}

/** The song share sheet while one is open (`openSongShare`), over Now Playing and the app. */
export function SongShareLayer() {
  const content = useSongShare();
  return content === null ? null : <SongSharePreview content={content} />;
}
