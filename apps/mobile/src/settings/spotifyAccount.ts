import {
  SPOTIFY_ACCOUNT_SIGNED_OUT,
  stepSpotifyAccount,
  type SpotifyAccountState,
  type SpotifySession,
} from "@wave/core";
import { useCallback, useEffect, useReducer } from "react";

import { WaveSpotify, spotifySignInFailure } from "@/native/waveSpotify";

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
    void (async () => {
      changed(await WaveSpotify.session());
      changed(await WaveSpotify.checkSession());
    })().catch(() => {});
    return () => subscription.remove();
  }, []);

  const signIn = useCallback(() => {
    dispatch({ type: "signInStarted" });
    WaveSpotify.signIn().then(
      (session) =>
        dispatch(
          session === null
            ? { type: "signInCancelled" }
            : { type: "signInEnded", outcome: session },
        ),
      (error: unknown) => dispatch({ type: "signInFailed", reason: spotifySignInFailure(error) }),
    );
  }, []);

  const signOut = useCallback(() => {
    WaveSpotify.signOut().then(
      (session) => dispatch({ type: "sessionChanged", session }),
      () => {},
    );
  }, []);

  return { state, signIn, signOut };
};
