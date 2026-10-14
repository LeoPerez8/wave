/**
 * The Wave account, as Settings › Wave Account shows it. Signing in is
 * optional: signed out, Wave works as before and sends the sync service
 * nothing. The session itself (its token) stays native; Core only sees who is
 * signed in.
 */

import type { AlertSpec } from "./alert.ts";

/**
 * The card before the first sign-in on a phone: what goes up to Wave's
 * server and what never does (story 80). Continue opens Google's picker;
 * Cancel changes nothing.
 */
export const WAVE_ACCOUNT_CARD = {
  title: "What goes up to Wave",
  message:
    "Signed in, your song list, playlists, favorites, play history and preferences go up to " +
    "Wave's server, and so does the Soulseek account Download in best quality made. Audio, " +
    "file paths and your YouTube sign-in never do.",
  action: { label: "Continue" },
} as const satisfies AlertSpec;

/** Delete Account asks first: the server's copy goes, the phone's stays. */
export const CONFIRM_WAVE_ACCOUNT_DELETION = {
  title: "Delete your Wave account?",
  message:
    "Wave's server deletes everything it has of the account, and this phone signs out. " +
    "Nothing on this phone is deleted.",
  action: { label: "Delete Account", destructive: true },
} as const satisfies AlertSpec;

/** Where this build's sync service is and the Google client its ID tokens are for. */
export interface WaveAccountConfig {
  /** The service's origin, without a trailing slash. */
  readonly syncUrl: string;
  /** Wave's web OAuth client id: the audience of the ID tokens the service accepts. */
  readonly googleWebClientId: string;
}

/**
 * The Wave account's setup from the app config's `extra` (`syncUrl`,
 * `googleWebClientId`); null until both are filled in, as on a build made
 * before the service was deployed.
 */
export const waveAccountConfig = (extra: unknown): WaveAccountConfig | null => {
  if (typeof extra !== "object" || extra === null) return null;
  const { syncUrl, googleWebClientId } = extra as Record<string, unknown>;
  if (typeof syncUrl !== "string" || typeof googleWebClientId !== "string") return null;
  const url = syncUrl.trim().replace(/\/+$/, "");
  const clientId = googleWebClientId.trim();
  if (!/^https?:\/\/[^/\s]+/.test(url) || clientId === "") return null;
  return { syncUrl: url, googleWebClientId: clientId };
};

/** The signed-in Google account, as Google's sign-in and the service name it. */
export interface WaveAccount {
  readonly email: string;
  readonly name: string | null;
  /** The account's Google picture, when it has one. */
  readonly photoUrl: string | null;
}

/** Whether Wave holds a session with the sync service, as the native module reports it. */
export type WaveSession =
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly account: WaveAccount }
  /** The service stopped accepting the session (a 401): signed out, until a new sign-in. */
  | { readonly status: "ended"; readonly account: WaveAccount | null };

/**
 * Why signing in didn't work: no network, the phone has no Google account to
 * pick, the service turned this Google account away (its allowlist), or
 * Google or the service didn't answer or accept it.
 */
export type WaveSignInFailure = "offline" | "noGoogleAccount" | "notAllowed" | "failed";

/** Why deleting the account didn't work: no network, or the service didn't answer. */
export type WaveDeleteFailure = "offline" | "failed";

/** Settings › Wave Account, with what's going on right now. */
export interface WaveAccountState {
  readonly session: WaveSession;
  /**
   * Waiting on Google's picker or the service: signing in (the picker is
   * open, or the service is checking its answer), signing out or deleting.
   */
  readonly busy: "signingIn" | "signingOut" | "deleting" | null;
  /** Why the last sign-in or deletion didn't work, until the next one starts. */
  readonly failure: WaveSignInFailure | null;
  /** The account was just deleted (until the next sign-in or session change). */
  readonly deleted: boolean;
}

export const WAVE_ACCOUNT_SIGNED_OUT: WaveAccountState = {
  session: { status: "signedOut" },
  busy: null,
  failure: null,
  deleted: false,
};

export type WaveAccountEvent =
  /** Continue on the card (or Sign In, once the card has been seen): the picker opens. */
  | { readonly type: "signInStarted" }
  /** The service answered the picker's ID token with a session. */
  | { readonly type: "signInEnded"; readonly session: WaveSession }
  | { readonly type: "signInFailed"; readonly reason: WaveSignInFailure }
  /** The owner backed out of Google's picker. */
  | { readonly type: "signInCancelled" }
  /** Sign Out: the service is told, and the phone forgets the session either way. */
  | { readonly type: "signOutStarted" }
  /** Delete Account, once confirmed. */
  | { readonly type: "deleteStarted" }
  /** The service deleted the account; the app is signed out. */
  | { readonly type: "accountDeleted" }
  | { readonly type: "deleteFailed"; readonly reason: WaveDeleteFailure }
  /**
   * The native module's session now: read when Settings opens, forgotten by
   * Sign Out, or ended by the service during a request.
   */
  | { readonly type: "sessionChanged"; readonly session: WaveSession };

export const stepWaveAccount = (
  state: WaveAccountState,
  event: WaveAccountEvent,
): WaveAccountState => {
  switch (event.type) {
    case "signInStarted":
      return { ...state, busy: "signingIn", failure: null, deleted: false };
    case "signInEnded":
      return { session: event.session, busy: null, failure: null, deleted: false };
    case "signInFailed":
      return { ...state, busy: null, failure: event.reason };
    case "signInCancelled":
      return { ...state, busy: null };
    case "signOutStarted":
      return { ...state, busy: "signingOut", failure: null };
    case "deleteStarted":
      return { ...state, busy: "deleting", failure: null };
    case "accountDeleted":
      return { session: { status: "signedOut" }, busy: null, failure: null, deleted: true };
    case "deleteFailed":
      return { ...state, busy: null, failure: event.reason };
    case "sessionChanged":
      return {
        session: event.session,
        busy: null,
        failure: null,
        deleted: state.deleted && event.session.status === "signedOut",
      };
  }
};

/**
 * The line under the signed-out section: what the account is for, that the
 * service ended the session, that the account was deleted, or why signing in
 * didn't work.
 */
export type WaveAccountNote = "about" | "ended" | "deleted" | WaveSignInFailure;

export type WaveAccountView =
  /** This build has no sync service set up (app.config.ts extra is empty). */
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "signedOut";
      /** `signingIn` while Google's picker is open: the button waits. */
      readonly action: "signIn" | "signInAgain" | "signingIn";
      readonly note: WaveAccountNote;
    }
  | {
      readonly kind: "account";
      readonly account: WaveAccount;
      /** Sign Out or Delete Account is waiting on the service: both buttons wait. */
      readonly busy: "signingOut" | "deleting" | null;
      /** Why deleting didn't work. */
      readonly note: WaveDeleteFailure | null;
    };

/**
 * What Settings › Wave Account shows, given whether this build has the
 * service's URL and Google's client id. Without them there's no Sign In, but
 * a signed-in account can still be signed out of.
 */
export const waveAccountView = (state: WaveAccountState, configured: boolean): WaveAccountView => {
  const { session, busy, failure } = state;
  if (session.status === "signedIn")
    return {
      kind: "account",
      account: session.account,
      busy: busy === "signingOut" || busy === "deleting" ? busy : null,
      note: failure === "offline" || failure === "failed" ? failure : null,
    };
  if (!configured) return { kind: "unavailable" };
  const ended = session.status === "ended";
  return {
    kind: "signedOut",
    action: busy === "signingIn" ? "signingIn" : ended ? "signInAgain" : "signIn",
    note: failure ?? (ended ? "ended" : state.deleted ? "deleted" : "about"),
  };
};
