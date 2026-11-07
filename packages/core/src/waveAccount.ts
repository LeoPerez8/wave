/**
 * The Wave account, as Settings › Wave Account shows it. Signing in is
 * optional: signed out, Wave works as before and sends the sync service
 * nothing. The session itself (its token) stays native; Core only sees who is
 * signed in.
 */

import type { AlertSpec } from "./alert.ts";
import { en, type Catalogue } from "./catalogueEn.ts";

/**
 * The card before the first sign-in on a phone: what goes up to Wave's
 * server and what never does (story 80). Continue opens Google's picker;
 * Cancel changes nothing.
 */
export const waveAccountCard = ({ settings: { waveAccountCard: text } }: Catalogue = en) =>
  ({
    title: text.title,
    message: text.message,
    action: { label: text.action },
  }) satisfies AlertSpec;

export const WAVE_ACCOUNT_CARD = waveAccountCard();

/** Delete Account asks first: the server's copy goes, the phone's stays. */
export const confirmWaveAccountDeletion = ({
  settings: { deleteWaveAccount: text },
}: Catalogue = en) =>
  ({
    title: text.title,
    message: text.message,
    action: { label: text.action, destructive: true },
  }) satisfies AlertSpec;

export const CONFIRM_WAVE_ACCOUNT_DELETION = confirmWaveAccountDeletion();

/**
 * Sign Out on All Phones asks first: every session of the account ends, this
 * phone's too, for when one may have been stolen.
 */
export const confirmSignOutEverywhere = ({
  settings: { signOutEverywhere: text },
}: Catalogue = en) =>
  ({
    title: text.title,
    message: text.message,
    action: { label: text.action, destructive: true },
  }) satisfies AlertSpec;

export const CONFIRM_SIGN_OUT_EVERYWHERE = confirmSignOutEverywhere();

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

/**
 * Why deleting the account didn't work: no network, the service didn't
 * answer, or Google's fresh sign-in wasn't the account's own Google account.
 */
export type WaveDeleteFailure = "offline" | "failed" | "wrongGoogleAccount";

/** Why Sign Out on All Phones didn't work: no network, or the service didn't answer. */
export type WaveSignOutEverywhereFailure = "offline" | "failed";

/** Why something the signed-in account section started didn't work. */
export type WaveAccountActionNote =
  WaveDeleteFailure | "signOutEverywhereOffline" | "signOutEverywhereFailed";

/** Settings › Wave Account, with what's going on right now. */
export interface WaveAccountState {
  readonly session: WaveSession;
  /**
   * Waiting on Google's picker or the service: signing in (the picker is
   * open, or the service is checking its answer), signing out or deleting.
   */
  readonly busy: "signingIn" | "signingOut" | "signingOutEverywhere" | "deleting" | null;
  /** Why the last sign-in, deletion or Sign Out on All Phones didn't work, until the next one starts. */
  readonly failure: WaveSignInFailure | WaveAccountActionNote | null;
  /**
   * The account was just deleted, or every phone just signed out (until the
   * next sign-in or session change).
   */
  readonly left: "deleted" | "signedOutEverywhere" | null;
}

export const WAVE_ACCOUNT_SIGNED_OUT: WaveAccountState = {
  session: { status: "signedOut" },
  busy: null,
  failure: null,
  left: null,
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
  /** The owner backed out of the Google picker Delete Account opens: nothing was sent. */
  | { readonly type: "deleteCancelled" }
  /** Sign Out on All Phones, once confirmed. */
  | { readonly type: "signOutEverywhereStarted" }
  /** The service ended every session of the account; the app is signed out. */
  | { readonly type: "signedOutEverywhere" }
  | { readonly type: "signOutEverywhereFailed"; readonly reason: WaveSignOutEverywhereFailure }
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
      return { ...state, busy: "signingIn", failure: null, left: null };
    case "signInEnded":
      return { session: event.session, busy: null, failure: null, left: null };
    case "signInFailed":
      return { ...state, busy: null, failure: event.reason };
    case "signInCancelled":
      return { ...state, busy: null };
    case "signOutStarted":
      return { ...state, busy: "signingOut", failure: null };
    case "deleteStarted":
      return { ...state, busy: "deleting", failure: null };
    case "accountDeleted":
      return { session: { status: "signedOut" }, busy: null, failure: null, left: "deleted" };
    case "deleteFailed":
      return { ...state, busy: null, failure: event.reason };
    case "deleteCancelled":
      return { ...state, busy: null };
    case "signOutEverywhereStarted":
      return { ...state, busy: "signingOutEverywhere", failure: null };
    case "signedOutEverywhere":
      return {
        session: { status: "signedOut" },
        busy: null,
        failure: null,
        left: "signedOutEverywhere",
      };
    case "signOutEverywhereFailed":
      return {
        ...state,
        busy: null,
        failure:
          event.reason === "offline" ? "signOutEverywhereOffline" : "signOutEverywhereFailed",
      };
    case "sessionChanged":
      return {
        session: event.session,
        busy: null,
        failure: null,
        left: event.session.status === "signedOut" ? state.left : null,
      };
  }
};

/**
 * The line under the signed-out section: what the account is for, that the
 * service ended the session, that the account was deleted, or why signing in
 * didn't work.
 */
export type WaveAccountNote =
  "about" | "ended" | "deleted" | "signedOutEverywhere" | WaveSignInFailure;

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
      /** Sign Out, Sign Out on All Phones or Delete Account is waiting: every button waits. */
      readonly busy: "signingOut" | "signingOutEverywhere" | "deleting" | null;
      /** Why deleting or Sign Out on All Phones didn't work. */
      readonly note: WaveAccountActionNote | null;
    };

const ACTION_NOTES: ReadonlySet<string> = new Set<WaveAccountActionNote>([
  "offline",
  "failed",
  "wrongGoogleAccount",
  "signOutEverywhereOffline",
  "signOutEverywhereFailed",
]);

const isActionNote = (
  failure: WaveSignInFailure | WaveAccountActionNote,
): failure is WaveAccountActionNote => ACTION_NOTES.has(failure);

const SIGN_IN_FAILURES: ReadonlySet<string> = new Set<WaveSignInFailure>([
  "offline",
  "noGoogleAccount",
  "notAllowed",
  "failed",
]);

const isSignInFailure = (
  failure: WaveSignInFailure | WaveAccountActionNote,
): failure is WaveSignInFailure => SIGN_IN_FAILURES.has(failure);

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
      busy: busy === "signingIn" ? null : busy,
      note: failure !== null && isActionNote(failure) ? failure : null,
    };
  if (!configured) return { kind: "unavailable" };
  const ended = session.status === "ended";
  return {
    kind: "signedOut",
    action: busy === "signingIn" ? "signingIn" : ended ? "signInAgain" : "signIn",
    note:
      failure !== null && isSignInFailure(failure)
        ? failure
        : ended
          ? "ended"
          : (state.left ?? "about"),
  };
};
