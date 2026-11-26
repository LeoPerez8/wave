import {
  confirmSignOutEverywhere,
  confirmWaveAccountDeletion,
  waveAccountCard,
  WAVE_ACCOUNT_SIGNED_OUT,
  stepWaveAccount,
  waveAccountConfig,
  type WaveAccountState,
  type WaveDeleteFailure,
  type WaveSession,
  type WaveSignInFailure,
} from "@wave/core";
import Constants from "expo-constants";
import { useCallback, useEffect, useReducer } from "react";

import { currentLocalisation } from "@/localisation/localisation";
import { persistedSetting } from "@/lib/persistedSetting";
import { WaveAccount, waveAccountErrorCode } from "@/native/waveAccount";
import { confirmAction } from "@/overlay/alert";
import { ytSignInAfterWave } from "@/settings/ytSignInAfterWave";

/**
 * The sync service's URL and Wave's web client id, from app.config.ts extra;
 * null on a build made before the service was set up.
 */
const WAVE_ACCOUNT_CONFIG = waveAccountConfig(Constants.expoConfig?.extra);

/** Whether this build has a sync service, so a Wave account can sign in at all. */
export const waveAccountAvailable = WAVE_ACCOUNT_CONFIG !== null;

/** The sync service's address on this build (its `/invite` links open Wave); null without one. */
export const waveSyncUrl: string | null = WAVE_ACCOUNT_CONFIG?.syncUrl ?? null;

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
    case "ERR_WAVE_ACCOUNTS_FULL":
      return "accountsFull";
    case "ERR_WAVE_NEW_ACCOUNTS_PAUSED":
      return "newAccountsPaused";
    case "ERR_WAVE_SESSIONS_FULL":
      return "sessionsFull";
    default:
      return "failed";
  }
};

const deleteFailure = (error: unknown): WaveDeleteFailure => {
  switch (waveAccountErrorCode(error)) {
    case "ERR_WAVE_OFFLINE":
      return "offline";
    case "ERR_WAVE_GOOGLE_NOT_CONFIRMED":
      return "wrongGoogleAccount";
    default:
      return "failed";
  }
};

const signOutEverywhereFailure = (error: unknown): "offline" | "failed" =>
  waveAccountErrorCode(error) === "ERR_WAVE_OFFLINE" ? "offline" : "failed";

type WaveAccountAction = Parameters<typeof stepWaveAccount>[1];

/**
 * An account action that asks first: once [confirmation] is confirmed it
 * dispatches [started], then what [call] ends with: [done] when it signs
 * out, the session when the service had ended it already, [cancelled] when
 * the owner backed out (a null session), or [failed] with its error.
 */
const confirmedAccountAction = async (
  dispatch: (action: WaveAccountAction) => void,
  steps: {
    readonly confirmation: () => Parameters<typeof confirmAction>[0];
    readonly started: WaveAccountAction;
    readonly call: () => Promise<WaveSession | null>;
    readonly done: WaveAccountAction;
    readonly cancelled?: WaveAccountAction;
    readonly failed: (error: unknown) => WaveAccountAction;
  },
): Promise<void> => {
  if (!(await confirmAction(steps.confirmation()))) return;
  dispatch(steps.started);
  try {
    const session = await steps.call();
    if (session === null) {
      if (steps.cancelled !== undefined) dispatch(steps.cancelled);
      return;
    }
    dispatch(session.status === "signedOut" ? steps.done : { type: "sessionChanged", session });
  } catch (error) {
    dispatch(steps.failed(error));
  }
};

/** What a sign-in came to; `declined` is the card about what goes up turned down. */
export type WaveSignInOutcome =
  | { readonly type: "signedIn"; readonly session: WaveSession }
  | { readonly type: "cancelled" }
  | { readonly type: "declined" }
  | { readonly type: "failed"; readonly reason: WaveSignInFailure };

/**
 * Settings' Sign In, from anywhere: the card about what goes up the first time, then Google's
 * account picker; [started] runs as the picker opens. Cancelling either sends nothing. Never
 * rejects.
 */
export const signInWaveAccount = async (started?: () => void): Promise<WaveSignInOutcome> => {
  const config = WAVE_ACCOUNT_CONFIG;
  if (config === null) return { type: "failed", reason: "failed" };
  if (!cardSeen.get() && !(await confirmAction(waveAccountCard(currentLocalisation().strings))))
    return { type: "declined" };
  started?.();
  try {
    const session = await WaveAccount.signIn(config.syncUrl, config.googleWebClientId);
    if (session === null) return { type: "cancelled" };
    cardSeen.set(true);
    return { type: "signedIn", session };
  } catch (error) {
    return { type: "failed", reason: signInFailure(error) };
  }
};

/**
 * Settings › Wave Account and the invitation (Core's `stepWaveAccount`): the
 * native module's session, and any change it hears of while Settings is open
 * (a 401 ends it). Sign In shows the card about what goes up the first time,
 * then Google's account picker; cancelling either sends nothing. A sign-in
 * that works opens YT Music's next when it's on and signed out. Sign Out on
 * All Phones asks first. Delete Account asks first, then opens Google's
 * account picker for a fresh sign-in, which the service needs to delete.
 */
export const useWaveAccount = (): {
  readonly state: WaveAccountState;
  readonly signIn: () => void;
  readonly signOut: () => void;
  readonly signOutEverywhere: () => void;
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
    void signInWaveAccount(() => dispatch({ type: "signInStarted" })).then((outcome) => {
      if (outcome.type === "signedIn") {
        dispatch({ type: "signInEnded", session: outcome.session });
        void ytSignInAfterWave(outcome.session);
      } else if (outcome.type === "cancelled") dispatch({ type: "signInCancelled" });
      else if (outcome.type === "failed")
        dispatch({ type: "signInFailed", reason: outcome.reason });
    });
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

  const signOutEverywhere = useCallback(() => {
    void confirmedAccountAction(dispatch, {
      confirmation: () => confirmSignOutEverywhere(currentLocalisation().strings),
      started: { type: "signOutEverywhereStarted" },
      call: () => WaveAccount.signOutEverywhere(),
      done: { type: "signedOutEverywhere" },
      failed: (error) => ({
        type: "signOutEverywhereFailed",
        reason: signOutEverywhereFailure(error),
      }),
    });
  }, []);

  const deleteAccount = useCallback(() => {
    const config = WAVE_ACCOUNT_CONFIG;
    void confirmedAccountAction(dispatch, {
      confirmation: () => confirmWaveAccountDeletion(currentLocalisation().strings),
      started: { type: "deleteStarted" },
      // The fresh Google sign-in the service needs is for Wave's web client.
      call: () =>
        config === null
          ? Promise.reject(new Error("This build has no sync service"))
          : WaveAccount.deleteAccount(config.googleWebClientId),
      done: { type: "accountDeleted" },
      cancelled: { type: "deleteCancelled" },
      failed: (error) => ({ type: "deleteFailed", reason: deleteFailure(error) }),
    });
  }, []);

  return { state, signIn, signOut, signOutEverywhere, deleteAccount };
};
