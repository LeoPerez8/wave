import {
  YT_ACCOUNT_SIGNED_OUT,
  stepYtAccount,
  type YtAccountState,
  type YtSession,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useReducer } from "react";

import { appRuntime } from "@/library/runtime";
import { WaveYtMusic } from "@/native/waveYtMusic";
import { YtMusic } from "@/ytmusic/YtMusic";

const withYtMusic = <A, E>(use: (ytMusic: YtMusic["Service"]) => Effect.Effect<A, E>) =>
  appRuntime.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const ytMusic = yield* YtMusic;
        return yield* use(ytMusic);
      }),
    ),
  );

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
    void withYtMusic((ytMusic) =>
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
    void withYtMusic((ytMusic) => ytMusic.signIn).then((result) => {
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
    void withYtMusic((ytMusic) => ytMusic.signOut).then((result) => {
      if (Result.isSuccess(result)) dispatch({ type: "sessionChanged", session: result.success });
    });
  }, []);

  return { state, signIn, signOut };
};
