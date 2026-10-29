import {
  confirmWaveAccountDeletion,
  waveAccountCard,
  WAVE_ACCOUNT_SIGNED_OUT,
  stepWaveAccount,
  waveAccountConfig,
  type WaveAccountState,
  type WaveSession,
  type WaveSignInFailure,
} from "@wave/core";
import Constants from "expo-constants";
import { useCallback, useEffect, useReducer } from "react";

import { currentLocalisation } from "@/localisation/localisation";
import { persistedSetting } from "@/lib/persistedSetting";
import { WaveAccount, waveAccountErrorCode } from "@/native/waveAccount";
import { confirmAction } from "@/overlay/alert";

/**
 * The sync service's URL and Wave's web client id, from app.config.ts extra;
 * null on a build made before the service was set up.
 */
export const WAVE_ACCOUNT_CONFIG = waveAccountConfig(Constants.expoConfig?.extra);

/** Whether the card about what goes up has led to a sign-in on this phone (it shows until then). */
const cardSeen = persistedSetting<boolean>({
  key: "waveAccount.cardSeen",
  read: (stored) => stored === "seen",
  write: (seen) => (seen ? "seen" : null),
});

const signInFailure = (error: unknown): WaveSignInFailure => {
  switch (waveAccountErrorCode(error)) {
    case "ERR_WAVE_OFFLINE":
      return "offline";
    case "ERR_WAVE_NO_GOOGLE_ACCOUNT":
      return "noGoogleAccount";
    case "ERR_WAVE_NOT_ALLOWED":
      return "notAllowed";
    default:
      return "failed";
  }
};

/**
 * Settings › Wave Account (Core's `stepWaveAccount`): the native module's
 * session, and any change it hears of while Settings is open (a 401 ends it).
 * Sign In shows the card about what goes up the first time, then Google's
 * account picker; cancelling either sends nothing. Delete Account asks first.
 */
export const useWaveAccount = (): {
  readonly state: WaveAccountState;
  readonly signIn: () => void;
  readonly signOut: () => void;
  readonly deleteAccount: () => void;
} => {
  const [state, dispatch] = useReducer(stepWaveAccount, WAVE_ACCOUNT_SIGNED_OUT);

  useEffect(() => {
    const changed = (session: WaveSession) => dispatch({ type: "sessionChanged", session });
    const subscription = WaveAccount.addListener("onSessionChanged", changed);
    void WaveAccount.session().then(changed, () => {});
    return () => subscription.remove();
  }, []);

  const signIn = useCallback(() => {
    const config = WAVE_ACCOUNT_CONFIG;
    if (config === null) return;
    void (async () => {
      if (!cardSeen.get() && !(await confirmAction(waveAccountCard(currentLocalisation().strings))))
        return;
      dispatch({ type: "signInStarted" });
      try {
        const session = await WaveAccount.signIn(config.syncUrl, config.googleWebClientId);
        if (session === null) {
          dispatch({ type: "signInCancelled" });
          return;
        }
        cardSeen.set(true);
        dispatch({ type: "signInEnded", session });
      } catch (error) {
        dispatch({ type: "signInFailed", reason: signInFailure(error) });
      }
    })();
  }, []);

  const signOut = useCallback(() => {
    dispatch({ type: "signOutStarted" });
    void WaveAccount.signOut().then(
      (session) => dispatch({ type: "sessionChanged", session }),
      () =>
        void WaveAccount.session().then(
          (session) => dispatch({ type: "sessionChanged", session }),
          () => {},
        ),
    );
  }, []);

  const deleteAccount = useCallback(() => {
    void (async () => {
      if (!(await confirmAction(confirmWaveAccountDeletion(currentLocalisation().strings)))) return;
      dispatch({ type: "deleteStarted" });
      try {
        const session = await WaveAccount.deleteAccount();
        dispatch(
          session.status === "signedOut"
            ? { type: "accountDeleted" }
            : { type: "sessionChanged", session },
        );
      } catch (error) {
        dispatch({
          type: "deleteFailed",
          reason: waveAccountErrorCode(error) === "ERR_WAVE_OFFLINE" ? "offline" : "failed",
        });
      }
    })();
  }, []);

  return { state, signIn, signOut, deleteAccount };
};
