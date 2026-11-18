/**
 * The YouTube account's text in Settings › Accounts: what each note of `ytAccountView` says, on
 * the phone and on the computer (the desktop's catalogue words the lines that name the device).
 */
import type { Catalogue } from "./catalogueEn.ts";
import type { YtAccountNote } from "./ytAccount.ts";

/** The line under Sign In: what the account is for, or why signing in didn't work. */
export const ytAccountNotes = ({ settings }: Catalogue): Record<YtAccountNote, string> => ({
  optional: settings.ytMusicNote,
  expired: settings.yourYouTubeSessionEndedSoYTMusic,
  offline: settings.couldntSignInWithoutAConnection,
  failed: settings.youtubeDidntConfirmTheSigninTryAgain,
});
