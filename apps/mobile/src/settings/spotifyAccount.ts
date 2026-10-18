import {
  SPOTIFY_ACCOUNT_SIGNED_OUT,
  SPOTIFY_SIGN_IN_FAILURE_LINES,
  stepSpotifyAccount,
  type SpotifyAccountState,
  type SpotifySession,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useReducer } from "react";

import { WaveSpotify } from "@/native/waveSpotify";
import { showMessage } from "@/overlay/alert";
import { askSpotify } from "@/spotify/askSpotify";

/**
 * The Spotify account for Settings › Accounts (Core's `stepSpotifyAccount`):
 * the saved session at once, then what Spotify says about it (a session it
 * stopped accepting shows as signed out), and any change the native module
 * hears of while Settings is open. Sign In opens Spotify's page; Sign Out
 * forgets the session.
 */
export const useSpotifyAccount = (): {
  readonly state: SpotifyAccountState;
  readonly signIn: () => void;
  readonly signOut: () => void;
} => {
  const [state, dispatch] = useReducer(stepSpotifyAccount, SPOTIFY_ACCOUNT_SIGNED_OUT);

  useEffect(() => {
    const changed = (session: SpotifySession) => dispatch({ type: "sessionChanged", session });
    const subscription = WaveSpotify.addListener("onSessionChanged", changed);
    void askSpotify((spotify) =>
      Effect.gen(function* () {
        changed(yield* spotify.session);
        return yield* spotify.checkSession;
      }),
    ).then((result) => {
      if (Result.isSuccess(result)) changed(result.success);
    });
    return () => subscription.remove();
  }, []);

  const signIn = useCallback(() => {
    dispatch({ type: "signInStarted" });
    void askSpotify((spotify) => spotify.signIn).then((result) => {
      if (Result.isFailure(result))
        dispatch({ type: "signInFailed", reason: result.failure.signInFailure });
      else if (result.success === null) dispatch({ type: "signInCancelled" });
      else dispatch({ type: "signInEnded", outcome: result.success });
    });
  }, []);

  const signOut = useCallback(() => {
    void askSpotify((spotify) => spotify.signOut).then((result) => {
      if (Result.isSuccess(result)) dispatch({ type: "sessionChanged", session: result.success });
    });
  }, []);

  return { state, signIn, signOut };
};

/** Whether Wave holds a Spotify session, as saved (Spotify isn't asked); no answer is no. */
export const spotifySignedIn = async (): Promise<boolean> => {
  const session = await askSpotify((spotify) => spotify.session);
  return Result.isSuccess(session) && session.success.status === "signedIn";
};

/**
 * Opens Spotify's sign-in page (Settings › Accounts' sign-in), for From
 * Spotify and sharing on Spotify; true once signed in. Backing out of it is
 * false with nothing said; a sign-in that didn't work says why, as Settings
 * does (Core's `SPOTIFY_SIGN_IN_FAILURE_LINES`).
 */
export const signInToSpotify = async (): Promise<boolean> => {
  const result = await askSpotify((spotify) => spotify.signIn);
  if (Result.isFailure(result)) {
    void showMessage(
      "Couldn't sign in",
      SPOTIFY_SIGN_IN_FAILURE_LINES[result.failure.signInFailure],
    );
    return false;
  }
  return result.success?.status === "signedIn";
};
