import { useEffect } from "react";
import { AppState } from "react-native";

import { WaveNative } from "@/native/waveNative";
import { openInviteLink } from "@/sync/inviteJoin";

import { openSharedText } from "./importPlaylistLink";
import { markLinkOffered } from "./offeredLink";

/** A share or a tapped link opened Wave since it last left the foreground. */
let openedSinceAway = false;

/** Whether a share or a tapped link opened Wave on this return (the copied-link offer skips it). */
export const linkOpenedThisReturn = (): boolean => openedSinceAway;

/**
 * Opens the share or tapped link waiting for Wave, if any (`openSharedText`), or the join screen
 * of an invite link (`openInviteLink`), and counts its link as offered. Says whether one was.
 */
export const openPendingShare = (): boolean => {
  const text = WaveNative.takeSharedText();
  if (text === null) return false;
  openedSinceAway = true;
  markLinkOffered(text);
  // A collaborative playlist's invite link opens its join screen.
  if (!openInviteLink(text)) openSharedText(text);
  return true;
};

/**
 * Opens what's shared to Wave from another app's share sheet, or tapped in another app
 * (`openPendingShare`): the share that started Wave, then each one while it runs. Waits for [ready]
 * (the Library's screens are up), keeping a share made before then for when they are. Leaving the
 * foreground forgets that a link opened Wave (`linkOpenedThisReturn`). Called once, by the root
 * layout.
 */
export const useOpenSharedText = (ready: boolean): void => {
  useEffect(() => {
    if (!ready) return;
    const openPending = () => void openPendingShare();
    const subscription = WaveNative.addListener("onShareReceived", openPending);
    const away = AppState.addEventListener("change", (state) => {
      if (state === "background") openedSinceAway = false;
    });
    openPending();
    return () => {
      subscription.remove();
      away.remove();
    };
  }, [ready]);
};
