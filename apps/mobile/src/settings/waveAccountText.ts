import type { Catalogue, WaveAccountNote } from "@wave/core";

/**
 * The Wave account's sign-in text, shared by Settings › Accounts and the
 * first run's invitation to sign in.
 */

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

/** Sign In's label, as it waits for Google's picker or after the service ended the session. */
export const waveSignInLabels = ({ settings }: Catalogue) => ({
  signIn: settings.signInWithGoogle,
  signInAgain: settings.signInAgain,
  signingIn: settings.signingIn,
});
