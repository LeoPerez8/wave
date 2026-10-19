/**
 * The YouTube account Wave uses for YT Music, as Settings › YT Music shows it.
 * Signing in is optional: signed out, YT Music works the same, and an expired
 * session counts as signed out until the owner signs in again. The session
 * itself (its cookie) stays native; Core only sees who is signed in.
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

/** The signed-in account, as YouTube Music names it. */
export interface YtAccount {
  readonly name: string;
  readonly email: string | null;
  /** The account's picture on YouTube's image server, when it has one. */
  readonly photoUrl: string | null;
}

/**
 * Whether Wave holds a YouTube session, as the native client reports it.
 * While YouTube doesn't accept it (expired), requests go out signed out.
 */
export type YtSession = AccountSession<YtAccount>;

/** Why a sign-in didn't work: no network, or YouTube didn't accept or answer it. */
export type YtSignInFailure = "offline" | "failed";

/** The account part of Settings › YT Music, with what's going on right now. */
export type YtAccountState = AccountSignInState<YtAccount, YtSignInFailure>;

export const YT_ACCOUNT_SIGNED_OUT: YtAccountState = ACCOUNT_SIGNED_OUT;

/** What happens to the account part of Settings: its sign-in, and the session native reports. */
export type YtAccountEvent = AccountSignInEvent<YtAccount, YtSignInFailure>;

export const stepYtAccount: (state: YtAccountState, event: YtAccountEvent) => YtAccountState =
  stepAccountSignIn;

/**
 * The line under the account part of Settings: signing in is optional, the
 * session ended and YouTube needs a new sign-in, or why the last sign-in
 * didn't work.
 */
export type YtAccountNote = AccountNote<YtSignInFailure>;

export type YtAccountView = AccountView<YtAccount, YtSignInFailure>;

/**
 * What Settings › YT Music shows about the account, given whether YT Music is
 * on; null for nothing. Off, there's no Sign In (it would talk to Google), but
 * a signed-in account can still be forgotten.
 */
export const ytAccountView = (state: YtAccountState, enabled: boolean): YtAccountView | null =>
  enabled || state.session.status === "signedIn" ? accountView(state) : null;
