import type { WaveAccountView } from "@wave/core";

/** What Settings › Accounts and the invitation to sign in show; the session stays in main. */
export interface AccountView {
  readonly account: WaveAccountView;
  /** No keyring: the session lasts until Wave quits, and Settings says so. */
  readonly keyringMissing: boolean;
  /** Delete Account's request went to the service: Cancel no longer stops it. */
  readonly deletionSent: boolean;
  /** The invitation to sign in is due: the first scan finished and it wasn't answered. */
  readonly invitation: boolean;
  /** Goes up when the account changed the Library: the window reads its lists again. */
  readonly revision: number;
  /** The account's theme choice (the phone's `settings.theme` value), or null. */
  readonly theme: string | null;
}
