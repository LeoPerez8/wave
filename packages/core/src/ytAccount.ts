/**
 * The YouTube account Wave uses for YT Music, as Settings › YT Music shows it.
 * Signing in is optional: signed out, YT Music works the same, and an expired
 * session counts as signed out until the owner signs in again. The session
 * itself (its cookie) stays native; Core only sees who is signed in.
 */

/** The signed-in account, as YouTube Music names it. */
export interface YtAccount {
  readonly name: string;
  readonly email: string | null;
  /** The account's picture on YouTube's image server, when it has one. */
  readonly photoUrl: string | null;
}

/** Whether Wave holds a YouTube session, as the native client reports it. */
export type YtSession =
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly account: YtAccount }
  /** YouTube stopped accepting the session; requests go out signed out. */
  | { readonly status: "expired"; readonly account: YtAccount | null };

/** The account part of Settings › YT Music, with what's going on right now. */
export interface YtAccountState {
  readonly session: YtSession;
  /** The sign-in page is open, or its session is being checked. */
  readonly signingIn: boolean;
  /** Why the last sign-in didn't work, until the next one starts. */
  readonly failure: YtSignInFailure | null;
}

/** Why a sign-in didn't work: no network, or YouTube didn't accept or answer it. */
export type YtSignInFailure = "offline" | "failed";

export const YT_ACCOUNT_SIGNED_OUT: YtAccountState = {
  session: { status: "signedOut" },
  signingIn: false,
  failure: null,
};

export type YtAccountEvent =
  | { readonly type: "signInStarted" }
  /** The sign-in page closed with this session. */
  | { readonly type: "signInEnded"; readonly outcome: YtSession }
  | { readonly type: "signInFailed"; readonly reason: YtSignInFailure }
  /** The owner backed out of the sign-in page. */
  | { readonly type: "signInCancelled" }
  /**
   * The native client's session now: read when Settings opens, checked with
   * YouTube, ended by YouTube during a request, or forgotten by Sign Out.
   */
  | { readonly type: "sessionChanged"; readonly session: YtSession };

export const stepYtAccount = (state: YtAccountState, event: YtAccountEvent): YtAccountState => {
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
 * The line under the account part of Settings: signing in is optional, the
 * session ended and YouTube needs a new sign-in, or why the last sign-in
 * didn't work.
 */
export type YtAccountNote = "optional" | "expired" | YtSignInFailure;

export type YtAccountView =
  | {
      readonly kind: "signedOut";
      /** `signingIn` while the sign-in page is open: the button waits. */
      readonly action: "signIn" | "signInAgain" | "signingIn";
      readonly note: YtAccountNote;
    }
  | { readonly kind: "account"; readonly account: YtAccount; readonly action: "signOut" };

/**
 * What Settings › YT Music shows about the account, given whether YT Music is
 * on; null for nothing. Off, there's no Sign In (it would talk to Google), but
 * a signed-in account can still be forgotten.
 */
export const ytAccountView = (state: YtAccountState, enabled: boolean): YtAccountView | null => {
  const { session } = state;
  if (session.status === "signedIn")
    return { kind: "account", account: session.account, action: "signOut" };
  if (!enabled) return null;
  const expired = session.status === "expired";
  return {
    kind: "signedOut",
    action: state.signingIn ? "signingIn" : expired ? "signInAgain" : "signIn",
    note: state.failure ?? (expired ? "expired" : "optional"),
  };
};
