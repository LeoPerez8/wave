/**
 * Signing in to an outside account from Settings (Spotify, YouTube Music): the
 * session the native side holds for an account [A], whether its sign-in page
 * is open, and why the last sign-in didn't work ([F]). Each account module
 * names its own account and failures.
 */

/** Whether Wave holds the service's session, as the native side reports it. */
export type AccountSession<A> =
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly account: A }
  /** The service stopped accepting the session; Sign In Again starts a new one. */
  | { readonly status: "expired"; readonly account: A | null };

/** The account's part of Settings, with what's going on right now. */
export interface AccountSignInState<A, F> {
  readonly session: AccountSession<A>;
  /** The sign-in page is open, or its session is being checked. */
  readonly signingIn: boolean;
  /** Why the last sign-in didn't work, until the next one starts. */
  readonly failure: F | null;
}

export const ACCOUNT_SIGNED_OUT: AccountSignInState<never, never> = {
  session: { status: "signedOut" },
  signingIn: false,
  failure: null,
};

export type AccountSignInEvent<A, F> =
  | { readonly type: "signInStarted" }
  /** The sign-in page closed with this session. */
  | { readonly type: "signInEnded"; readonly outcome: AccountSession<A> }
  | { readonly type: "signInFailed"; readonly reason: F }
  /** The owner backed out of the sign-in page. */
  | { readonly type: "signInCancelled" }
  /**
   * The native session now: read when Settings opens, checked with the
   * service, ended by the service during a request, or forgotten by Sign Out.
   */
  | { readonly type: "sessionChanged"; readonly session: AccountSession<A> };

export const stepAccountSignIn = <A, F>(
  state: AccountSignInState<A, F>,
  event: AccountSignInEvent<A, F>,
): AccountSignInState<A, F> => {
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
 * The line under the account's part of Settings: signing in is optional, the
 * session ended, or why the last sign-in didn't work.
 */
export type AccountNote<F> = "optional" | "expired" | F;

export type AccountView<A, F> =
  | {
      readonly kind: "signedOut";
      /** `signingIn` while the sign-in page is open: the button waits. */
      readonly action: "signIn" | "signInAgain" | "signingIn";
      readonly note: AccountNote<F>;
    }
  | { readonly kind: "account"; readonly account: A; readonly action: "signOut" };

/** What the account's part of Settings shows: the account, or Sign In and the line under it. */
export const accountView = <A, F>(state: AccountSignInState<A, F>): AccountView<A, F> => {
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
