import {
  YT_ACCOUNT_SIGNED_OUT,
  stepYtAccount,
  type YtAccountState,
  type YtSession,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useReducer } from "react";

import { WaveYtMusic } from "@/native/waveYtMusic";
import { showMessage } from "@/overlay/alert";
import { askYtMusic } from "@/ytmusic/askYtMusic";

/**
 * The YouTube account for Settings › YT Music (Core's `stepYtAccount`): the
 * saved session at once, then what YouTube says about it (a session that
 * ended shows as signed out), and any change the native client hears of while
 * Settings is open. Sign In opens Google's page; Sign Out forgets the session.
 */
export const useYtAccount = (): {
  readonly state: YtAccountState;
  readonly signIn: () => void;
  readonly signOut: () => void;
} => {
  const [state, dispatch] = useReducer(stepYtAccount, YT_ACCOUNT_SIGNED_OUT);

  useEffect(() => {
    const changed = (session: YtSession) => dispatch({ type: "sessionChanged", session });
    const subscription = WaveYtMusic.addListener("onSessionChanged", changed);
    void askYtMusic((ytMusic) =>
      Effect.gen(function* () {
        changed(yield* ytMusic.session);
        return yield* ytMusic.checkSession;
      }),
    ).then((result) => {
      if (Result.isSuccess(result)) changed(result.success);
    });
    return () => subscription.remove();
  }, []);

  const signIn = useCallback(() => {
    dispatch({ type: "signInStarted" });
    void askYtMusic((ytMusic) => ytMusic.signIn).then((result) => {
      if (Result.isFailure(result))
        dispatch({
          type: "signInFailed",
          reason: result.failure.reason === "offline" ? "offline" : "failed",
        });
      else if (result.success === null) dispatch({ type: "signInCancelled" });
      else dispatch({ type: "signInEnded", outcome: result.success });
    });
  }, []);

  const signOut = useCallback(() => {
    void askYtMusic((ytMusic) => ytMusic.signOut).then((result) => {
      if (Result.isSuccess(result)) dispatch({ type: "sessionChanged", session: result.success });
    });
  }, []);

  return { state, signIn, signOut };
};

/** Whether YT Music holds the account's session, as saved (YouTube isn't asked); no answer is no. */
export const ytMusicSignedIn = async (): Promise<boolean> => {
  const session = await askYtMusic((ytMusic) => ytMusic.session);
  return Result.isSuccess(session) && session.success.status === "signedIn";
};

const SIGN_IN_FAILED: Record<"offline" | "failed", string> = {
  offline: "Couldn't sign in without a connection.",
  failed: "YouTube didn't confirm the sign-in. Try again.",
};

/**
 * Opens YouTube Music's sign-in page (Settings' sign-in), for From YT Music
 * and sharing on YT Music; true once signed in. Backing out of it is false
 * with nothing said; a sign-in that didn't work says why.
 */
export const signInToYtMusic = async (): Promise<boolean> => {
  const result = await askYtMusic((ytMusic) => ytMusic.signIn);
  if (Result.isFailure(result)) {
    const reason = result.failure.reason === "offline" ? "offline" : "failed";
    void showMessage("Couldn't sign in", SIGN_IN_FAILED[reason]);
    return false;
  }
  return result.success?.status === "signedIn";
};
