/**
 * Share to Spotify in a playlist's menu: main makes or updates the playlist's public copy on
 * the Spotify account and copies its link; here are the sign-in question, the toasts and the
 * line that says why it stopped.
 */
import {
  PLAYLIST_SHARE_LABELS,
  sharePlaylistFailureLine,
  shareSignInAlert,
  sharedSongsCopiedLine,
  spotifySignInFailureLines,
  type AlertSpec,
} from "@wave/core";
import type { CopyLinkResult } from "../../shared/links.ts";
import { COPIED } from "./copyLink.ts";
import { text } from "./text.ts";

/** The message card every link action reports a problem in. */
const notice = (title: string, message: string): void => {
  const detail: CopyLinkResult = { kind: "notice", notice: { title, message } };
  document.dispatchEvent(new CustomEvent(COPIED, { detail }));
};

/** Whether Spotify is signed in, asking for the sign-in first when it isn't. */
const signedIn = async (ask: (spec: AlertSpec) => Promise<boolean>): Promise<boolean> => {
  if ((await window.wave.spotifyAccount.view()).account.kind === "account") return true;
  if (!(await ask(shareSignInAlert("spotify", text)))) return false;
  await window.wave.spotifyAccount.signIn();
  const { account } = await window.wave.spotifyAccount.view();
  if (account.kind === "account") return true;
  // A sign-in the user gave up says nothing; one that failed says why.
  const failures: Readonly<Record<string, string>> = spotifySignInFailureLines(text);
  const why = failures[account.note];
  if (why !== undefined) notice(text.share.shareFailed, why);
  return false;
};

export const shareToSpotify = async (
  playlist: { readonly id: number; readonly name: string },
  ask: (spec: AlertSpec) => Promise<boolean>,
  toast: (message: string) => void,
): Promise<void> => {
  const failed = (reason: Parameters<typeof sharePlaylistFailureLine>[1]) =>
    notice(text.share.shareFailed, sharePlaylistFailureLine("spotify", reason, text));
  try {
    if (!(await signedIn(ask))) return;
    toast(text.share.sharing(playlist.name, PLAYLIST_SHARE_LABELS.spotify));
    const outcome = await window.wave.spotifyShare.playlist(playlist.id);
    switch (outcome.kind) {
      case "shared":
        toast(sharedSongsCopiedLine(outcome, text));
        break;
      case "nothingFound":
        notice(text.share.nothingToShare, text.share.nothingFound.spotify);
        break;
      case "signIn":
        failed("signedOut");
        break;
      case "failed":
        failed(outcome.reason);
        break;
    }
  } catch {
    failed("failed");
  }
};
