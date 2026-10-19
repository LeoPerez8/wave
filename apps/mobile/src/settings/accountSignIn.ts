import type { AccountSession, AccountSignInEvent, AccountSignInState } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useReducer } from "react";

import { showMessage } from "@/overlay/alert";

/** What an outside account's service answers about its session (`Spotify`, `YtMusic`). */
interface AccountService<A, E> {
  /** The saved session; the service isn't asked. */
  readonly session: Effect.Effect<AccountSession<A>, E>;
  /** The saved session, as the service says it is now. */
  readonly checkSession: Effect.Effect<AccountSession<A>, E>;
  /** Opens the service's sign-in page; null when the owner backed out of it. */
  readonly signIn: Effect.Effect<AccountSession<A> | null, E>;
  /** Forgets the session. */
  readonly signOut: Effect.Effect<AccountSession<A>, E>;
}

interface AccountSignInConfig<A, F extends string, E> {
  /** Runs [use] on the account's service, resolving its answer or why there wasn't one. */
  readonly ask: <R>(
    use: (service: AccountService<A, E>) => Effect.Effect<R, E>,
  ) => Promise<Result.Result<R, E>>;
  /** Hears of every session the native side reports; `remove` stops. */
  readonly onSessionChanged: (changed: (session: AccountSession<A>) => void) => {
    remove(): void;
  };
  /** Core's reducer for the account, and where it starts. */
  readonly step: (
    state: AccountSignInState<A, F>,
    event: AccountSignInEvent<A, F>,
  ) => AccountSignInState<A, F>;
  readonly signedOut: AccountSignInState<A, F>;
  /** Why a sign-in that failed with [error] didn't work. */
  readonly failureOf: (error: E) => F;
  /** What Wave says about each failure. */
  readonly failureLines: { readonly [K in F]: string };
}

/**
 * Settings' sign-in to an outside account (Spotify, YouTube Music), and what
 * flows that need it ask: the account hook, whether it's signed in, and a
 * sign-in that says why it didn't work.
 */
export const accountSignIn = <A, F extends string, E>(config: AccountSignInConfig<A, F, E>) => {
  const { ask, step, failureOf } = config;

  /**
   * The account for Settings: the saved session at once, then what the
   * service says about it (one it stopped accepting shows as signed out), and
   * any change the native side hears of while Settings is open. Sign In opens
   * the service's page; Sign Out forgets the session.
   */
  const useAccount = (): {
    readonly state: AccountSignInState<A, F>;
    readonly signIn: () => void;
    readonly signOut: () => void;
  } => {
    const [state, dispatch] = useReducer(step, config.signedOut);

    useEffect(() => {
      const changed = (session: AccountSession<A>) => dispatch({ type: "sessionChanged", session });
      const subscription = config.onSessionChanged(changed);
      void ask((service) =>
        Effect.gen(function* () {
          changed(yield* service.session);
          return yield* service.checkSession;
        }),
      ).then((result) => {
        if (Result.isSuccess(result)) changed(result.success);
      });
      return () => subscription.remove();
    }, []);

    const signIn = useCallback(() => {
      dispatch({ type: "signInStarted" });
      void ask((service) => service.signIn).then((result) => {
        if (Result.isFailure(result))
          dispatch({ type: "signInFailed", reason: failureOf(result.failure) });
        else if (result.success === null) dispatch({ type: "signInCancelled" });
        else dispatch({ type: "signInEnded", outcome: result.success });
      });
    }, []);

    const signOut = useCallback(() => {
      void ask((service) => service.signOut).then((result) => {
        if (Result.isSuccess(result)) dispatch({ type: "sessionChanged", session: result.success });
      });
    }, []);

    return { state, signIn, signOut };
  };

  /** Whether Wave holds the account's session, as saved (the service isn't asked); no answer is no. */
  const signedIn = async (): Promise<boolean> => {
    const session = await ask((service) => service.session);
    return Result.isSuccess(session) && session.success.status === "signedIn";
  };

  /**
   * Opens the service's sign-in page; true once signed in. Backing out of it
   * is false with nothing said; a sign-in that didn't work says why.
   */
  const signInTo = async (): Promise<boolean> => {
    const result = await ask((service) => service.signIn);
    if (Result.isFailure(result)) {
      void showMessage("Couldn't sign in", config.failureLines[failureOf(result.failure)]);
      return false;
    }
    return result.success?.status === "signedIn";
  };

  return { useAccount, signedIn, signInTo };
};
