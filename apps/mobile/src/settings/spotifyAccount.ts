import {
  SPOTIFY_ACCOUNT_SIGNED_OUT,
  SPOTIFY_SIGN_IN_FAILURE_LINES,
  stepSpotifyAccount,
} from "@wave/core";

import { WaveSpotify } from "@/native/waveSpotify";
import { askSpotify } from "@/spotify/askSpotify";

import { accountSignIn } from "./accountSignIn";

const spotifyAccount = accountSignIn({
  ask: askSpotify,
  onSessionChanged: (changed) => WaveSpotify.addListener("onSessionChanged", changed),
  step: stepSpotifyAccount,
  signedOut: SPOTIFY_ACCOUNT_SIGNED_OUT,
  // Spotify not taking the session it signed in with is its not confirming the sign-in.
  failureOf: (error) => (error.reason === "signedOut" ? "failed" : error.reason),
  failureLines: SPOTIFY_SIGN_IN_FAILURE_LINES,
});

/**
 * The Spotify account for Settings › Accounts (Core's `stepSpotifyAccount`):
 * the saved session at once, then what Spotify says about it (a session it
 * stopped accepting shows as signed out), and any change the native module
 * hears of while Settings is open. Sign In opens Spotify's page; Sign Out
 * forgets the session.
 */
export const useSpotifyAccount = spotifyAccount.useAccount;

/** Whether Wave holds a Spotify session, as saved (Spotify isn't asked); no answer is no. */
export const spotifySignedIn = spotifyAccount.signedIn;

/**
 * Opens Spotify's sign-in page (Settings › Accounts' sign-in), for From
 * Spotify and sharing on Spotify; true once signed in. Backing out of it is
 * false with nothing said; a sign-in that didn't work says why, as Settings
 * does (Core's `SPOTIFY_SIGN_IN_FAILURE_LINES`).
 */
export const signInToSpotify = spotifyAccount.signInTo;
