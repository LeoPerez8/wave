import {
  CLIP_LOOK_AGAIN_MS,
  type ClipHint,
  copiedLinkOffer,
  copiedTextReading,
  looksAtClipboard,
} from "@wave/core";
import { useEffect } from "react";
import { AppState } from "react-native";

import { currentLocalisation } from "@/localisation/localisation";
import { online, WaveNative } from "@/native/waveNative";
import { showToast } from "@/overlay/toast";
import { offerCopiedLinks } from "@/settings/offerCopiedLinks";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { isFirstRunDue } from "@/sync/signInInvitation";

import { openSharedText } from "./importPlaylistLink";
import { keepOfferedLink, lastOfferedLink } from "./offeredLink";
import { linkOpenedThisReturn, openPendingShare } from "./sharedText";

/** The timestamp of the clip whose text Wave read last, so a clip is read once per run. */
let lastReadClip: number | null = null;
/** Counts the clipboard looks, so a newer one ends an older one still waiting on a clip. */
let currentLook = 0;

/**
 * The description of the clip whose text Wave reads now, or null (Core's `copiedTextReading`): a
 * clip still being classified is looked at again after `CLIP_LOOK_AGAIN_MS`, as long as Wave stays
 * in front and no newer look has started.
 */
const clipToRead = async (): Promise<ClipHint | null> => {
  const thisLook = ++currentLook;
  const stillThisLook = (): boolean =>
    thisLook === currentLook && AppState.currentState === "active";
  for (let look = 1; ; look++) {
    const hint = (await WaveNative.readClipHint?.()) ?? null;
    if (hint === null || !stillThisLook()) return null;
    const reading = copiedTextReading(hint, lastReadClip, look);
    if (reading === "read") return hint;
    if (reading === "skip") return null;
    await new Promise((resolve) => setTimeout(resolve, CLIP_LOOK_AGAIN_MS));
    if (!stillThisLook()) return null;
  }
};

/**
 * Offers the link on the clipboard, once (docs/spec.md, "Opening a song link"): a share or a
 * tapped link waiting for Wave opens instead, and Core says whether to look at the clipboard
 * (`looksAtClipboard`), whether its description makes the text worth reading
 * (`copiedTextReading`, so plain text doesn't make Android announce a paste), and the toast
 * (`copiedLinkOffer`). A clip still being classified is looked at again shortly while Wave stays
 * in front. Nothing is asked of any service until the toast's action is tapped, which does what
 * sharing the link to Wave does. An APK without the description read offers nothing.
 */
const offerCopiedLink = async (): Promise<void> => {
  if (openPendingShare()) return;
  const looks = looksAtClipboard({
    offerCopiedLinks: offerCopiedLinks(),
    ytMusic: ytMusicEnabled(),
    online: online(),
    welcomeTour: isFirstRunDue(),
    openedByLink: linkOpenedThisReturn(),
  });
  if (!looks || WaveNative.readClipHint === undefined) return;
  const hint = await clipToRead();
  if (hint === null) return;
  const text = await WaveNative.readClipboardText();
  lastReadClip = hint.timestamp;
  if (text === null) return;
  const offer = copiedLinkOffer(text, lastOfferedLink(), currentLocalisation().language);
  if (offer === null) return;
  keepOfferedLink(offer.key);
  void showToast(offer.text, { label: offer.action, run: () => openSharedText(text) });
};

const offerSafely = (): void => {
  offerCopiedLink().catch(() => {
    // The clipboard couldn't be read (Wave lost focus): the clip isn't marked read, so a later
    // return looks again.
  });
};

/**
 * Looks at the clipboard as Wave opens, once [ready] (the Library's screens are up), and each time
 * it comes back to the foreground. Android 10+ lets only the focused app read the clipboard, so a
 * return looks again once Wave's window has focus; a clip already read or a link already offered
 * isn't offered twice. Called once, by the root layout.
 */
export const useCopiedLinkToasts = (ready: boolean): void => {
  useEffect(() => {
    if (!ready) return;
    let returning = true;
    const change = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      returning = true;
      offerSafely();
    });
    const focus = AppState.addEventListener("focus", () => {
      if (!returning) return;
      returning = false;
      offerSafely();
    });
    offerSafely();
    return () => {
      change.remove();
      focus.remove();
    };
  }, [ready]);
};
