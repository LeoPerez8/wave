/**
 * The Spotify account Wave reads (and later writes) the owner's library with,
 * as Settings › Accounts › Spotify shows it. The session itself (the `sp_dc`
 * cookie and the tokens it buys) stays native; Core only sees who is signed in.
 */

/** The signed-in account, as Spotify names it. */
export interface SpotifyAccount {
  readonly name: string;
  /** The account's photo on Spotify's image server, when it has one. */
  readonly photoUrl: string | null;
}

/** Whether Wave holds a Spotify session, as the native module reports it. */
export type SpotifySession =
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly account: SpotifyAccount }
  /** Spotify stopped accepting the session; it's gone, and Sign In Again starts a new one. */
  | { readonly status: "expired"; readonly account: SpotifyAccount | null };

/**
 * Why a sign-in didn't work: no network, Spotify didn't confirm it, or
 * Spotify changed how its web player signs in, so Wave needs an update.
 */
export type SpotifySignInFailure = "offline" | "failed" | "changed";

/** The Spotify part of Settings › Accounts, with what's going on right now. */
export interface SpotifyAccountState {
  readonly session: SpotifySession;
  /** Spotify's sign-in page is open, or its session is being checked. */
  readonly signingIn: boolean;
  /** Why the last sign-in didn't work, until the next one starts. */
  readonly failure: SpotifySignInFailure | null;
}

export const SPOTIFY_ACCOUNT_SIGNED_OUT: SpotifyAccountState = {
  session: { status: "signedOut" },
  signingIn: false,
  failure: null,
};

export type SpotifyAccountEvent =
  | { readonly type: "signInStarted" }
  /** The sign-in page closed with this session. */
  | { readonly type: "signInEnded"; readonly outcome: SpotifySession }
  | { readonly type: "signInFailed"; readonly reason: SpotifySignInFailure }
  /** The owner backed out of the sign-in page. */
  | { readonly type: "signInCancelled" }
  /**
   * The native session now: read when Settings opens, checked with Spotify,
   * ended by Spotify during a request, or forgotten by Sign Out.
   */
  | { readonly type: "sessionChanged"; readonly session: SpotifySession };

export const stepSpotifyAccount = (
  state: SpotifyAccountState,
  event: SpotifyAccountEvent,
): SpotifyAccountState => {
  switch (event.type) {
    case "signInStarted":
      return { ...state, signingIn: true, failure: null };
    case "signInEnded":
      return { session: event.outcome, signingIn: false, failure: null };
    case "signInFailed":
      return { ...state, signingIn: false, failure: event.reason };
    case "signInCancelled":
      return { ...state, signingIn: false };
    case "sessionChanged":
      return { ...state, session: event.session, failure: null };
  }
};

/**
 * The line under the Spotify part of Settings: what signing in is for, the
 * session ended, or why the last sign-in didn't work.
 */
export type SpotifyAccountNote = "optional" | "expired" | SpotifySignInFailure;

export type SpotifyAccountView =
  | {
      readonly kind: "signedOut";
      /** `signingIn` while the sign-in page is open: the button waits. */
      readonly action: "signIn" | "signInAgain" | "signingIn";
      readonly note: SpotifyAccountNote;
    }
  | { readonly kind: "account"; readonly account: SpotifyAccount; readonly action: "signOut" };

/** What Settings › Accounts › Spotify shows about the account. */
export const spotifyAccountView = (state: SpotifyAccountState): SpotifyAccountView => {
  const { session } = state;
  if (session.status === "signedIn")
    return { kind: "account", account: session.account, action: "signOut" };
  const expired = session.status === "expired";
  return {
    kind: "signedOut",
    action: state.signingIn ? "signingIn" : expired ? "signInAgain" : "signIn",
    note: state.failure ?? (expired ? "expired" : "optional"),
  };
};
