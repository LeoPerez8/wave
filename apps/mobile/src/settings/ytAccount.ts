import {
  YT_ACCOUNT_SIGNED_OUT,
  stepYtAccount,
  type YtAccount,
  type YtSignInFailure,
} from "@wave/core";

import { WaveYtMusic } from "@/native/waveYtMusic";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import type { YtMusicError } from "@/ytmusic/YtMusic";

import { accountSignIn } from "./accountSignIn";

const ytAccount = accountSignIn<YtAccount, YtSignInFailure, YtMusicError>({
  ask: askYtMusic,
  onSessionChanged: (changed) => WaveYtMusic.addListener("onSessionChanged", changed),
  step: stepYtAccount,
  signedOut: YT_ACCOUNT_SIGNED_OUT,
  failureOf: (error) => (error.reason === "offline" ? "offline" : "failed"),
  failureLines: {
    offline: "Couldn't sign in without a connection.",
    failed: "YouTube didn't confirm the sign-in. Try again.",
  },
});

/**
 * The YouTube account for Settings › YT Music (Core's `stepYtAccount`): the
 * saved session at once, then what YouTube says about it (a session that
 * ended shows as signed out), and any change the native client hears of while
 * Settings is open. Sign In opens Google's page; Sign Out forgets the session.
 */
export const useYtAccount = ytAccount.useAccount;

/** Whether YT Music holds the account's session, as saved (YouTube isn't asked); no answer is no. */
export const ytMusicSignedIn = ytAccount.signedIn;

/**
 * Opens YouTube Music's sign-in page (Settings' sign-in), for From YT Music
 * and sharing on YT Music; true once signed in. Backing out of it is false
 * with nothing said; a sign-in that didn't work says why.
 */
export const signInToYtMusic = ytAccount.signInTo;
