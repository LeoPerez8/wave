import { copiedLinkOffer, looksAtClipboard, readsCopiedText } from "@wave/core";
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

/**
 * Offers the link on the clipboard, once (docs/spec.md, "Opening a song link"): a share or a
 * tapped link waiting for Wave opens instead, and Core says whether to look at the clipboard
 * (`looksAtClipboard`), whether its description makes the text worth reading
 * (`readsCopiedText`, so plain text doesn't make Android announce a paste), and the toast
 * (`copiedLinkOffer`). Nothing is asked of any service until the toast's action is tapped, which
 * does what sharing the link to Wave does. An APK without the description read offers nothing.
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
  const hint = await WaveNative.readClipHint();
  if (hint === null || !readsCopiedText(hint, lastReadClip)) return;
  lastReadClip = hint.timestamp;
  const text = await WaveNative.readClipboardText();
  if (text === null) return;
  const offer = copiedLinkOffer(text, lastOfferedLink(), currentLocalisation().language);
  if (offer === null) return;
  keepOfferedLink(offer.key);
  void showToast(offer.text, { label: offer.action, run: () => openSharedText(text) });
};

const offerSafely = (): void => {
  offerCopiedLink().catch(() => {
    // The clipboard couldn't be read (Wave lost focus): a later return looks again.
  });
};

/**
 * Looks at the clipboard as Wave opens, once [ready] (the Library's screens are up), and each time
 * it comes back to the foreground. Android 10+ lets only the focused app read the clipboard, so a
 * return looks again once Wave's window has focus; a clip already read or a link already offered
 * isn't offered twice. Called once, by the root layout.
 */
export const useOfferCopiedLinks = (ready: boolean): void => {
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
