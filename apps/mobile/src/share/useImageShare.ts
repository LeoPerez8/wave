import { useLocalisation } from "@/localisation/localisation";
import {
  IconBrandInstagram,
  IconBrandWhatsapp,
  IconDots,
  IconPhotoDown,
} from "@tabler/icons-react-native";
import {
  lyricShareDestinations,
  type LyricShareApps,
  type LyricShareDestination,
  type LyricStoryBackground,
  type LyricStoryFrame,
} from "@wave/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { appLog } from "@/log/appLog";
import { showToast } from "@/overlay/toast";

import type { ShareDestination } from "./ShareDestinations";
import {
  imageShareApps,
  openImageShareSheet,
  saveImageToGallery,
  shareImageToInstagramStory,
  shareImageToWhatsApp,
  writeViewPng,
  type ImageSource,
} from "./shareImage";

const NO_APPS: LyricShareApps = { instagramStories: false, whatsapp: false };

/** The apps the last preview found: the row's layout while the next one checks again. */
let lastApps: LyricShareApps | null = null;

/**
 * The preview's corners, switched only while its image is drawn (the song
 * card squares them for standalone exports): [drawing] while switched;
 * [startDrawing] switches them and resolves a frame later, once they've
 * reached the native view the image is
 * drawn from; [endDrawing] switches them back.
 */
export const useDrawingCorners = (): {
  readonly drawing: boolean;
  readonly startDrawing: () => Promise<void>;
  readonly endDrawing: () => void;
} => {
  const [drawing, setDrawing] = useState(false);
  const drawn = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!drawing) return;
    const resolve = drawn.current;
    drawn.current = null;
    requestAnimationFrame(() => resolve?.());
  }, [drawing]);
  const startDrawing = useCallback(
    () =>
      new Promise<void>((resolve) => {
        drawn.current = resolve;
        setDrawing(true);
      }),
    [],
  );
  const endDrawing = useCallback(() => setDrawing(false), []);
  return { drawing, startDrawing, endDrawing };
};

export interface ImageShareOptions {
  /** The view drawn into the image. */
  readonly source: ImageSource;
  /** The image's file name, asked as it's drawn (it carries the time). */
  readonly fileName: () => string;
  /** What's shared, for the log: "the lyrics card". */
  readonly what: string;
  /** Android's share sheet's title (More). */
  readonly sheetTitle: string;
  readonly logTag: string;
  /** The Instagram story's background behind the image. */
  readonly storyBackground: LyricStoryBackground;
  /** Lyrics-only transparent sticker framing, applied by the native export before delivery. */
  readonly storyFrame?: LyricStoryFrame;
  /** Readies the view before it's drawn for [destination] (`useDrawingCorners`). */
  readonly prepare?: (destination: LyricShareDestination) => Promise<void>;
  /** Undoes `prepare` once the image is drawn, whichever destination it was for. */
  readonly afterDraw?: () => void;
}

/**
 * A share preview's destinations (docs/spec.md, "Sharing lyrics"): Instagram
 * Stories and WhatsApp when they're on hand, then Save image and More, each
 * drawing the view into a PNG and sending it, one at a time. `known` is false
 * until some check of the apps has answered (the row stays hidden, keeping its
 * place); `disabled` while an image is on its way or this preview's own check
 * hasn't answered. A row of its own (the song sheet's, with its links) orders
 * `image`, each destination by its key, from `apps`, the apps on hand.
 */
export function useImageShare({
  source,
  fileName,
  what,
  sheetTitle,
  logTag,
  storyBackground,
  storyFrame,
  prepare,
  afterDraw,
}: ImageShareOptions): {
  readonly destinations: readonly ShareDestination[];
  readonly image: Readonly<Record<LyricShareDestination, ShareDestination>>;
  readonly apps: LyricShareApps;
  readonly known: boolean;
  readonly disabled: boolean;
} {
  const { strings } = useLocalisation();
  const [busy, setBusy] = useState(false);
  // Two taps in one frame both see busy false; this sees the first.
  const sending = useRef(false);
  // Null until this preview's own check answers: an app removed since the last one stays
  // offered otherwise. The last answer lays the row out meanwhile, its buttons disabled.
  const [apps, setApps] = useState<LyricShareApps | null>(null);
  const [laidOutAs] = useState(lastApps);

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

  const sendImage = async (
    destination: LyricShareDestination,
    action: string,
    send: (path: string) => Promise<void>,
    failed: string,
  ): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      if (prepare !== undefined) await prepare(destination);
      const path = await writeViewPng(source, fileName()).finally(() => afterDraw?.());
      await send(path);
    } catch (error) {
      appLog("warn", logTag, `Couldn't ${action}: ${String(error)}`);
      void showToast(failed);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const all: Record<LyricShareDestination, ShareDestination> = {
    instagramStories: {
      key: "instagramStories",
      label: strings.share.instagramStories,
      icon: IconBrandInstagram,
      onPress: () =>
        void sendImage(
          "instagramStories",
          `share ${what} to Instagram Stories`,
          (path) => shareImageToInstagramStory(path, storyBackground, storyFrame),
          strings.share.instagramFailed,
        ),
    },
    whatsapp: {
      key: "whatsapp",
      label: strings.share.whatsApp,
      icon: IconBrandWhatsapp,
      onPress: () =>
        void sendImage(
          "whatsapp",
          `share ${what} to WhatsApp`,
          shareImageToWhatsApp,
          strings.share.whatsAppFailed,
        ),
    },
    save: {
      key: "save",
      label: strings.share.saveImage,
      icon: IconPhotoDown,
      onPress: () =>
        void sendImage(
          "save",
          `save ${what}`,
          async (path) => {
            await saveImageToGallery(path);
            void showToast(strings.share.savedToGallery);
          },
          strings.share.saveImageFailed,
        ),
    },
    more: {
      key: "more",
      label: strings.share.more,
      icon: IconDots,
      onPress: () =>
        void sendImage(
          "more",
          `share ${what}`,
          (path) => openImageShareSheet(path, sheetTitle),
          strings.share.shareImageFailed,
        ),
    },
  };
  const shown = apps ?? laidOutAs;
  return {
    destinations: lyricShareDestinations(shown ?? NO_APPS).map((key) => all[key]),
    image: all,
    apps: shown ?? NO_APPS,
    known: shown !== null,
    disabled: busy || apps === null,
  };
}
