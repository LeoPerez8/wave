/**
 * The Spotify account Wave reads (and later writes) the owner's library with,
 * as Settings › Accounts › Spotify shows it. The session itself (the `sp_dc`
 * cookie and the tokens it buys) stays native; Core only sees who is signed in.
 */

import {
  ACCOUNT_SIGNED_OUT,
  accountView,
  stepAccountSignIn,
  type AccountNote,
  type AccountSession,
  type AccountSignInEvent,
  type AccountSignInState,
  type AccountView,
} from "./accountSignIn.ts";

/** The signed-in account, as Spotify names it. */
export interface SpotifyAccount {
  readonly name: string;
  /** The account's photo on Spotify's image server, when it has one. */
  readonly photoUrl: string | null;
}

/**
 * Whether Wave holds a Spotify session, as the native module reports it. One
 * Spotify stopped accepting is gone, and Sign In Again starts a new one.
 */
export type SpotifySession = AccountSession<SpotifyAccount>;

/**
 * Why a sign-in didn't work: no network, Spotify didn't confirm it, or
 * Spotify changed how its web player signs in, so Wave needs an update.
 */
export type SpotifySignInFailure = "offline" | "failed" | "changed";

/** What Wave says when Spotify changed its web player: an update of Wave reads it again. */
export const SPOTIFY_CHANGED_LINE = "Spotify changed something. Try again after updating Wave.";

/** Why a sign-in didn't work, as Settings, From Spotify and sharing say it. */
export const SPOTIFY_SIGN_IN_FAILURE_LINES: { readonly [F in SpotifySignInFailure]: string } = {
  offline: "Couldn't sign in without a connection.",
  failed: "Spotify didn't confirm the sign-in. Try again.",
  changed: SPOTIFY_CHANGED_LINE,
};

/** The Spotify part of Settings › Accounts, with what's going on right now. */
export type SpotifyAccountState = AccountSignInState<SpotifyAccount, SpotifySignInFailure>;

export const SPOTIFY_ACCOUNT_SIGNED_OUT: SpotifyAccountState = ACCOUNT_SIGNED_OUT;

/** What happens to the Spotify part of Settings: its sign-in, and the session native reports. */
export type SpotifyAccountEvent = AccountSignInEvent<SpotifyAccount, SpotifySignInFailure>;

export const stepSpotifyAccount: (
  state: SpotifyAccountState,
  event: SpotifyAccountEvent,
) => SpotifyAccountState = stepAccountSignIn;

/**
 * The line under the Spotify part of Settings: what signing in is for, the
 * session ended, or why the last sign-in didn't work.
 */
export type SpotifyAccountNote = AccountNote<SpotifySignInFailure>;

export type SpotifyAccountView = AccountView<SpotifyAccount, SpotifySignInFailure>;

/** What Settings › Accounts › Spotify shows about the account. */
export const spotifyAccountView: (state: SpotifyAccountState) => SpotifyAccountView = accountView;
