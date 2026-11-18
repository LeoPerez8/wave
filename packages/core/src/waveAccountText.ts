/**
 * The Wave account's text in Settings › Accounts and the first run's invitation to sign in: what
 * each note and label of `waveAccountView` says, on the phone and on the computer (the desktop's
 * catalogue words the lines that name the device).
 */
import type { Catalogue } from "./catalogueEn.ts";
import type { WaveAccountActionNote, WaveAccountNote, WaveAccountView } from "./waveAccount.ts";

/** The line under Sign In: what the account is for, or why signing in didn't work. */
export const waveAccountNotes = ({ settings }: Catalogue): Record<WaveAccountNote, string> => ({
  about: settings.waveAccountNote,
  ended: settings.yourWaveSessionEndedSoThisPhone,
  deleted: settings.yourWaveAccountWasDeletedEverythingOn,
  signedOutEverywhere: settings.everyPhoneOnThisWaveAccountSignedOut,
  offline: settings.couldntSignInWithoutAConnection,
  noGoogleAccount: settings.addAGoogleAccountToThisPhone,
  notAllowed: settings.thisGoogleAccountCantUseWavesServer,
  accountsFull: settings.wavesServerHasNoRoomForNewAccounts,
  newAccountsPaused: settings.wavesServerMadeAllTheNewAccountsItCanToday,
  failed: settings.couldntSignInTryAgain,
});

type SignInAction = Extract<WaveAccountView, { kind: "signedOut" }>["action"];

/** Sign In's label, as it waits for Google or after the service ended the session. */
export const waveSignInLabels = ({ settings }: Catalogue): Record<SignInAction, string> => ({
  signIn: settings.signInWithGoogle,
  signInAgain: settings.signInAgain,
  signingIn: settings.signingIn,
});

/** The line under the account's buttons: why deleting or signing out everywhere didn't work. */
export const waveAccountActionNotes = ({
  settings,
}: Catalogue): Record<WaveAccountActionNote, string> => ({
  offline: settings.couldntDeleteTheAccountWithoutAConnection,
  failed: settings.wavesServerDidntDeleteTheAccountTry,
  wrongGoogleAccount: settings.googleDidntConfirmThisAccountPick,
  signOutEverywhereOffline: settings.couldntSignOutOnAllPhonesWithoutAConnection,
  signOutEverywhereFailed: settings.wavesServerDidntSignOutThePhonesTry,
});
