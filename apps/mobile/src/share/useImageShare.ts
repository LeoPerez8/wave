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
} from "@wave/core";
import { useEffect, useRef, useState } from "react";

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
  /** Readies the view for Instagram's sticker before it's drawn (the lyrics card rounds its corners). */
  readonly prepareSticker?: () => Promise<void>;
  /** Undoes `prepareSticker` once the image is drawn, whichever destination it was for. */
  readonly afterDraw?: () => void;
}

/**
 * A share preview's destinations (docs/spec.md, "Sharing lyrics"): Instagram
 * Stories and WhatsApp when they're on hand, then Save image and More, each
 * drawing the view into a PNG and sending it, one at a time. `known` is false
 * until some check of the apps has answered (the row stays hidden, keeping its
 * place); `disabled` while an image is on its way or this preview's own check
 * hasn't answered.
 */
export function useImageShare({
  source,
  fileName,
  what,
  sheetTitle,
  logTag,
  storyBackground,
  prepareSticker,
  afterDraw,
}: ImageShareOptions): {
  readonly destinations: readonly ShareDestination[];
  readonly known: boolean;
  readonly disabled: boolean;
} {
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
    action: string,
    send: (path: string) => Promise<void>,
    failed: string,
    { sticker = false }: { readonly sticker?: boolean } = {},
  ): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      if (sticker && prepareSticker !== undefined) await prepareSticker();
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
      label: "Instagram Stories",
      icon: IconBrandInstagram,
      onPress: () =>
        void sendImage(
          `share ${what} to Instagram Stories`,
          (path) => shareImageToInstagramStory(path, storyBackground),
          "Couldn't open Instagram",
          { sticker: true },
        ),
    },
    whatsapp: {
      key: "whatsapp",
      label: "WhatsApp",
      icon: IconBrandWhatsapp,
      onPress: () =>
        void sendImage(`share ${what} to WhatsApp`, shareImageToWhatsApp, "Couldn't open WhatsApp"),
    },
    save: {
      key: "save",
      label: "Save image",
      icon: IconPhotoDown,
      onPress: () =>
        void sendImage(
          `save ${what}`,
          async (path) => {
            await saveImageToGallery(path);
            void showToast("Saved to your gallery");
          },
          "Couldn't save the image",
        ),
    },
    more: {
      key: "more",
      label: "More",
      icon: IconDots,
      onPress: () =>
        void sendImage(
          `share ${what}`,
          (path) => openImageShareSheet(path, sheetTitle),
          "Couldn't share the image",
        ),
    },
  };
  const shown = apps ?? laidOutAs;
  return {
    destinations: lyricShareDestinations(shown ?? NO_APPS).map((key) => all[key]),
    known: shown !== null,
    disabled: busy || apps === null,
  };
}
